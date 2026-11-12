import { describe, expect, it } from 'vitest';
import {
  PRIMARY_GOALS,
  resolveOneRm,
  type AthleteCard,
  type BlockTemplate,
} from '@trektren/shared';
import { addDays } from '../src/dates.js';
import { loadExercises, type Exercise } from '../src/modules/exercises/repo.js';
import { filterAvailable } from '../src/modules/plan/availability.js';
import { heavyGroups, layoutSessions } from '../src/modules/plan/layout.js';
import { loadFor } from '../src/modules/plan/loads.js';
import { normalizeTemplate } from '../src/modules/plan/normalize.js';
import { buildRulesTemplate } from '../src/modules/plan/rules.js';
import { describeSchedule } from '../src/modules/plan/schedule.js';
import { estimateMaxes } from '../src/modules/strength/estimate.js';
import { mergeLift } from '../src/modules/strength/service.js';

// 2026-11-16 — понедельник.
const MON = '2026-11-16';
const week = (offsets: number[], start = MON) => offsets.map((d) => addDays(start, d));

const card: AthleteCard = {
  goals: { primary: 'hypertrophy' },
  basics: { sex: 'male', heightCm: 180, weightKg: 80 },
  availability: { sessionsPerWeek: 3, sessionMinutes: 75 },
};

async function base() {
  const all = await loadExercises();
  return { all, map: new Map(all.map((e) => [e.slug, e])) };
}

function rulesFor(c: AthleteCard, all: Exercise[], dates: string[]): BlockTemplate {
  const { available } = filterAvailable(all, c);
  return buildRulesTemplate(c, available, describeSchedule(dates, c.availability?.sessionsPerWeek));
}

describe('база упражнений', () => {
  it('загружена миграцией и у базовых есть шаг веса', async () => {
    const { all } = await base();
    expect(all.length).toBeGreaterThanOrEqual(60);
    const baseline = all.filter((e) => e.baseline);
    expect(baseline.map((e) => e.slug)).toEqual(
      expect.arrayContaining(['barbell-back-squat', 'bench-press', 'deadlift', 'overhead-press']),
    );
    for (const e of baseline) expect(e.weightStepKg).toBeGreaterThan(0);
  });
});

describe('доступность упражнений', () => {
  it('зал без списка снарядов — доступно всё', async () => {
    const { all } = await base();
    expect(filterAvailable(all, card).excluded).toEqual([]);
  });

  it('дом без снарядов — только упражнения с собственным весом', async () => {
    const { all } = await base();
    const { available } = filterAvailable(all, { ...card, equipment: { location: 'home' } });
    expect(available.length).toBeGreaterThan(0);
    for (const e of available) expect(e.requires).toEqual([]);
  });

  it('травма колена убирает тяжёлые приседы, запрет — по названию', async () => {
    const { all } = await base();
    const { available, excluded } = filterAvailable(all, {
      ...card,
      limitations: {
        injuries: [{ area: 'Колено', description: 'Боль при глубоком приседе' }],
        bannedMovements: ['Становая тяга'],
      },
    });
    const slugs = new Set(available.map((e) => e.slug));
    expect(slugs.has('barbell-back-squat')).toBe(false);
    expect(slugs.has('deadlift')).toBe(false);
    expect(excluded.find((e) => e.slug === 'barbell-back-squat')?.reason).toBe('injury');
    expect(excluded.find((e) => e.slug === 'deadlift')?.reason).toBe('banned');
    expect(slugs.has('bench-press')).toBe(true);
  });
});

describe('план по правилам', () => {
  it.each([1, 2, 3, 4, 5, 6])('%i тренировок в неделю — валидный шаблон', async (perWeek) => {
    const { all } = await base();
    const { available } = filterAvailable(all, card);
    for (const goal of PRIMARY_GOALS) {
      const c = { ...card, goals: { primary: goal }, availability: { sessionsPerWeek: perWeek } };
      const dates = Array.from({ length: perWeek }, (_, i) => addDays(MON, i));
      const template = buildRulesTemplate(c, available, describeSchedule(dates, perWeek));
      const checked = normalizeTemplate(template, available);
      expect(checked.ok, `${goal}, ${perWeek}/нед: ${JSON.stringify(checked)}`).toBe(true);
      if (checked.ok) expect(checked.warnings).toEqual([]);
    }
  });

  it('сплит зависит от частоты', async () => {
    const { all } = await base();
    const twice = { ...card, availability: { sessionsPerWeek: 2 } };
    expect(rulesFor(twice, all, week([0, 3])).sessions).toHaveLength(2);
    // По двум датам частоту не понять — берётся из карточки.
    expect(rulesFor(card, all, week([0, 3])).sessions).toHaveLength(3);
    expect(rulesFor(card, all, week([0, 2, 4])).split).toMatch(/Фулбади/);
    expect(rulesFor(card, all, week([0, 1, 3, 4])).split).toMatch(/Верх/);
    expect(rulesFor(card, all, week([0, 1, 2, 3, 4])).split).toMatch(/Толкай/);
  });

  it('силовая цель: при 3 днях — день приседа, жима и становой, не фулбади', async () => {
    const { all } = await base();
    const strong = { ...card, goals: { primary: 'strength' as const } };
    const t = rulesFor(strong, all, week([1, 3, 6]));
    expect(t.split).toBe('Присед / жим / становая');
    expect(t.sessions.map((s) => s.exercises[0]!.slug)).toEqual([
      'barbell-back-squat',
      'bench-press',
      'deadlift',
    ]);
    expect(
      rulesFor({ ...strong, availability: { sessionsPerWeek: 2 } }, all, week([0, 3])).sessions[1]!
        .exercises[0]!.slug,
    ).toBe('deadlift');
  });

  it('тренировка укладывается в заданное время', async () => {
    const { all } = await base();
    const short = { ...card, availability: { sessionsPerWeek: 3, sessionMinutes: 45 } };
    for (const s of rulesFor(short, all, week([0, 2, 4])).sessions) {
      const sets = s.exercises.reduce((n, x) => n + x.sets, 0);
      expect(sets * 2.5 + 10).toBeLessThanOrEqual(50);
    }
  });

  it('приоритетная мышца получает больше подходов', async () => {
    const { all, map } = await base();
    const volume = (t: BlockTemplate, muscle: string) =>
      t.sessions
        .flatMap((s) => s.exercises)
        .filter((x) => map.get(x.slug)!.primaryMuscles.includes(muscle))
        .reduce((n, x) => n + x.sets, 0);
    const plain = rulesFor(card, all, week([0, 2, 4]));
    const focused = rulesFor(
      { ...card, goals: { primary: 'hypertrophy', priorityMuscles: ['biceps'] } },
      all,
      week([0, 2, 4]),
    );
    expect(volume(focused, 'biceps')).toBeGreaterThan(volume(plain, 'biceps'));
  });

  it('дом без снарядов: план всё равно собирается', async () => {
    const { all } = await base();
    const home = { ...card, equipment: { location: 'home' as const } };
    const { available } = filterAvailable(all, home);
    const template = rulesFor(home, all, week([0, 2, 4]));
    expect(normalizeTemplate(template, available).ok).toBe(true);
  });
});

describe('раскладка по датам', () => {
  it('пн/ср/пт: ротация по порядку, недели и запас из шаблона', async () => {
    const { all, map } = await base();
    const dates = week([0, 2, 4, 7, 9, 11]);
    const t = rulesFor(card, all, dates);
    const laid = layoutSessions(t, dates, map);
    expect(laid.map((s) => s.planned.templateKey)).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    expect(laid.map((s) => s.planned.week)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(laid[0]!.planned.gapDays).toBeNull();
    expect(laid[1]!.planned.gapDays).toBe(2);
    for (const s of laid) expect(s.planned.adjustments).toEqual([]);
    expect(laid[0]!.planned.exercises[0]!.rir).toBe(t.weeks[0]!.rir);
    expect(laid[3]!.planned.exercises[0]!.rir).toBe(t.weeks[1]!.rir);
  });

  it('верх/низ в соседние дни — без правок, группы разные', async () => {
    const { all, map } = await base();
    const dates = week([0, 1, 3, 4]);
    const t = rulesFor(card, all, dates);
    const laid = layoutSessions(t, dates, map);
    expect(laid.map((s) => s.planned.templateKey)).toEqual(['A', 'B', 'C', 'D']);
    for (const s of laid) expect(s.planned.adjustments).toEqual([]);
  });

  it('фулбади два дня подряд — второй день облегчён', async () => {
    const { all, map } = await base();
    const dates = week([0, 1]);
    const t = rulesFor({ ...card, availability: { sessionsPerWeek: 2 } }, all, dates);
    const laid = layoutSessions(t, dates, map);
    const second = laid[1]!.planned;
    expect(second.adjustments.join(' ')).toMatch(/не успеют восстановиться/);
    const template = t.sessions.find((s) => s.key === second.templateKey)!;
    expect(second.exercises[0]!.sets).toBe(template.exercises[0]!.sets - 1);
    expect(second.exercises[0]!.rir).toBe(
      Math.max(t.weeks[0]!.rir, map.get(template.exercises[0]!.slug)!.minRir) + 1,
    );
  });

  it('если есть тренировка на другие мышцы — ставит её вместо тяжёлой', async () => {
    const { map } = await base();
    const t: BlockTemplate = {
      split: 'Тест',
      accumulationWeeks: 3,
      weeks: [
        { rir: 3, extraSets: 0 },
        { rir: 2, extraSets: 0 },
        { rir: 1, extraSets: 0 },
      ],
      sessions: [
        {
          key: 'A',
          title: 'Ноги',
          exercises: [
            { slug: 'barbell-back-squat', sets: 4, repsMin: 5, repsMax: 8 },
            { slug: 'leg-extension', sets: 3, repsMin: 10, repsMax: 15 },
          ],
        },
        {
          key: 'B',
          title: 'Ноги 2',
          exercises: [
            { slug: 'front-squat', sets: 4, repsMin: 5, repsMax: 8 },
            { slug: 'leg-press', sets: 3, repsMin: 10, repsMax: 15 },
          ],
        },
        {
          key: 'C',
          title: 'Руки',
          exercises: [
            { slug: 'barbell-curl', sets: 3, repsMin: 8, repsMax: 12 },
            { slug: 'cable-pushdown', sets: 3, repsMin: 10, repsMax: 15 },
          ],
        },
      ],
      rotation: ['A', 'B', 'C'],
      rationale: 'Тест',
      coachNote: 'Тест',
    };
    expect(heavyGroups(t.sessions[0]!, map)).toContain('quads');
    const laid = layoutSessions(t, week([0, 1, 3]), map);
    expect(laid.map((s) => s.planned.templateKey)).toEqual(['A', 'C', 'B']);
    expect(laid[1]!.planned.adjustments[0]).toMatch(/Руки/);
  });

  it('после перерыва 10+ дней веса −10%', async () => {
    const { all, map } = await base();
    const dates = week([0, 12]);
    const laid = layoutSessions(rulesFor(card, all, dates), dates, map);
    expect(laid[0]!.planned.exercises[0]!.loadFactor).toBe(1);
    expect(laid[1]!.planned.exercises[0]!.loadFactor).toBe(0.9);
    expect(laid[1]!.planned.adjustments.join(' ')).toMatch(/Перерыв 12 дней/);
  });

  it('после накопления — разгрузка, дальше — «после блока»', async () => {
    const { all, map } = await base();
    const dates = Array.from({ length: 7 }, (_, w) => addDays(MON, w * 7));
    const t = rulesFor(card, all, week([0, 2, 4]));
    const laid = layoutSessions(t, dates, map);
    const deload = laid[t.accumulationWeeks]!.planned;
    expect(deload.phase).toBe('deload');
    expect(deload.exercises.every((x) => x.rir === 3 && x.loadFactor === 0.9)).toBe(true);
    const after = laid[t.accumulationWeeks + 1]!.planned;
    expect(after.phase).toBe('after_block');
    expect(after.exercises).toEqual([]);
  });
});

describe('рабочие веса', () => {
  const planned = { slug: 'bench-press', sets: 4, repsMin: 3, repsMax: 5, rir: 2, loadFactor: 1 };
  const own = (oneRmKg: number) => ({ oneRmKg, basis: 'own' as const });

  it('по 1ПМ: обратная формула Эпли, вниз до шага снаряда', async () => {
    const { map } = await base();
    // 100 / (1 + (4 + 2) / 30) = 83,3 → 82,5
    expect(loadFor(planned, map.get('bench-press'), own(100))).toEqual({
      kind: 'kg',
      kg: 82.5,
      oneRmKg: 100,
      basis: 'own',
      perHand: false,
    });
    expect(
      loadFor({ ...planned, loadFactor: 0.9 }, map.get('bench-press'), own(100)),
    ).toMatchObject({
      kg: 75,
    });
  });

  it('без данных — подбор, свой вес — без килограммов, блок — подбор на месте', async () => {
    const { map } = await base();
    expect(loadFor(planned, map.get('bench-press'), undefined)).toEqual({
      kind: 'calibrate',
      reason: 'no_data',
    });
    expect(loadFor({ ...planned, slug: 'push-up' }, map.get('push-up'), undefined)).toEqual({
      kind: 'bodyweight',
    });
    expect(
      loadFor({ ...planned, slug: 'lat-pulldown' }, map.get('lat-pulldown'), {
        oneRmKg: 80,
        basis: 'ratio',
      }),
    ).toEqual({ kind: 'calibrate', reason: 'stack' });
  });

  it('гантели — на руку и не тяжелее, чем есть в зале; штанга — не легче грифа', async () => {
    const { map } = await base();
    const db = {
      slug: 'incline-dumbbell-press',
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      rir: 2,
      loadFactor: 1,
    };
    const load = loadFor(db, map.get('incline-dumbbell-press'), {
      oneRmKg: 37,
      basis: 'ratio',
      fromSlug: 'bench-press',
    });
    expect(load).toMatchObject({
      kind: 'kg',
      perHand: true,
      basis: 'ratio',
      fromSlug: 'bench-press',
    });
    expect(
      loadFor(
        db,
        map.get('incline-dumbbell-press'),
        { oneRmKg: 100, basis: 'own' },
        { dumbbellMaxKg: 30 },
      ),
    ).toMatchObject({ kg: 30 });
    expect(loadFor(planned, map.get('bench-press'), own(15))).toMatchObject({ kg: 20 });
  });

  it('проходка — вес попытки как есть', async () => {
    const { map } = await base();
    expect(
      loadFor({ ...planned, targetKg: 127.5 }, map.get('bench-press'), own(120)),
    ).toMatchObject({
      kind: 'kg',
      kg: 127.5,
      basis: 'target',
    });
  });
});

describe('максимумы для всех упражнений', () => {
  const lift = (oneRmKg: number) => ({ oneRmKg, estimated: false, updatedAt: '2026-11-12' });

  it('свои — как есть, остальное через опорные движения', async () => {
    const { all } = await base();
    const maxes = estimateMaxes(
      {
        ...card,
        strength: {
          lifts: { 'barbell-back-squat': lift(120), 'bench-press': lift(100), deadlift: lift(170) },
        },
      },
      all,
    );
    expect(maxes.get('barbell-back-squat')).toEqual({ oneRmKg: 120, basis: 'own' });
    expect(maxes.get('front-squat')).toEqual({
      oneRmKg: 98.4,
      basis: 'ratio',
      fromSlug: 'barbell-back-squat',
    });
    expect(maxes.get('romanian-deadlift')).toMatchObject({ oneRmKg: 110.5, fromSlug: 'deadlift' });
    // Жима стоя нет — от жима лёжа, а гантели сидя — от него.
    expect(maxes.get('overhead-press')).toEqual({
      oneRmKg: 62,
      basis: 'ratio',
      fromSlug: 'bench-press',
    });
    expect(maxes.get('seated-dumbbell-press')).toMatchObject({
      basis: 'ratio',
      fromSlug: 'overhead-press',
    });
    expect(maxes.has('lat-pulldown')).toBe(false);
  });

  it('совсем без силовых — оценка по весу тела и стажу', async () => {
    const { all } = await base();
    const maxes = estimateMaxes(
      { ...card, basics: { sex: 'male', weightKg: 80 }, experience: { trainingYears: 2 } },
      all,
    );
    expect(maxes.get('barbell-back-squat')).toEqual({ oneRmKg: 112, basis: 'bodyweight' });
    expect(maxes.get('bench-press')).toEqual({ oneRmKg: 80, basis: 'bodyweight' });
    expect(maxes.get('front-squat')?.basis).toBe('bodyweight');
  });
});

describe('силовые: максимум и рабочий подход', () => {
  it('реальный максимум важнее расчёта по рабочему подходу', () => {
    expect(resolveOneRm({ testedKg: 100, working: { weightKg: 80, reps: 10, rir: 0 } })).toEqual({
      oneRmKg: 100,
      estimated: false,
    });
    expect(resolveOneRm({ working: { weightKg: 100, reps: 5, rir: 1 } })).toEqual({
      oneRmKg: 120,
      estimated: true,
    });
    // Подход свежее максимума и тяжелее — человек стал сильнее.
    expect(
      resolveOneRm({
        testedKg: 100,
        testedAt: '2026-09-01',
        working: { weightKg: 100, reps: 3, rir: 1 },
        workingAt: '2026-11-01',
      }),
    ).toEqual({ oneRmKg: 113.3, estimated: true });
    expect(resolveOneRm({})).toBeNull();
  });

  it('правка меняет только пришедшее, null удаляет', () => {
    const current = {
      oneRmKg: 106.7,
      estimated: true,
      updatedAt: '2026-11-10',
      working: { weightKg: 80, reps: 10, rir: 0 },
      workingAt: '2026-11-10',
    };
    const withMax = mergeLift(current, { testedKg: 100 }, '2026-11-12', 'user')!;
    expect(withMax).toMatchObject({
      oneRmKg: 100,
      estimated: false,
      testedKg: 100,
      testedAt: '2026-11-12',
    });
    expect(withMax.working).toEqual(current.working);
    const noMax = mergeLift(withMax, { testedKg: null }, '2026-11-12', 'user')!;
    expect(noMax).toMatchObject({ oneRmKg: 106.7, estimated: true });
    expect(noMax.testedKg).toBeUndefined();
    expect(mergeLift(noMax, { working: null }, '2026-11-12', 'user')).toBeNull();
    // Старая запись без подробностей остаётся как была.
    expect(
      mergeLift(
        { oneRmKg: 90, estimated: true, updatedAt: '2026-11-01' },
        {},
        '2026-11-12',
        'user',
      ),
    ).toMatchObject({
      oneRmKg: 90,
      updatedAt: '2026-11-01',
    });
  });
});

describe('проверка шаблона от ИИ', () => {
  const valid = (): BlockTemplate => ({
    split: 'Фулбади',
    accumulationWeeks: 4,
    weeks: [
      { rir: 3, extraSets: 0 },
      { rir: 2, extraSets: 0 },
      { rir: 2, extraSets: 1 },
    ],
    sessions: [
      {
        key: 'A',
        title: 'A',
        exercises: [
          { slug: 'bench-press', sets: 4, repsMin: 8, repsMax: 5 },
          { slug: 'barbell-row', sets: 4, repsMin: 6, repsMax: 8 },
          { slug: 'made-up-lift', sets: 3, repsMin: 8, repsMax: 10 },
        ],
      },
    ],
    rotation: ['A', 'Z'],
    rationale: 'Почему так',
    coachNote: 'Работай',
  });

  it('чинит мелочи и предупреждает', async () => {
    const { all } = await base();
    const result = normalizeTemplate(valid(), all);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings[0]).toMatch(/made-up-lift/);
    const a = result.template.sessions[0]!;
    expect(a.exercises.map((x) => x.slug)).toEqual(['bench-press', 'barbell-row']);
    expect(a.exercises[0]).toMatchObject({ repsMin: 5, repsMax: 8 });
    expect(result.template.rotation).toEqual(['A']);
    expect(result.template.weeks).toHaveLength(4);
  });

  it('грубые ошибки возвращает модели', async () => {
    const { all } = await base();
    const t = valid();
    t.sessions.push({
      ...t.sessions[0]!,
      exercises: [
        { slug: 'nope', sets: 3, repsMin: 5, repsMax: 8 },
        { slug: 'nope-2', sets: 3, repsMin: 5, repsMax: 8 },
      ],
    });
    const result = normalizeTemplate(t, all);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/повторяется/);
    expect(result.errors.join(' ')).toMatch(/меньше двух/);
    expect(normalizeTemplate({ split: 'x' }, all).ok).toBe(false);
  });
});
