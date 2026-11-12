import type {
  AthleteCard,
  BlockTemplate,
  PRIMARY_GOALS,
  SessionTemplate,
  TemplateExercise,
} from '@trektren/shared';
import type { Exercise } from '../exercises/repo.js';
import type { ScheduleInfo } from './schedule.js';

type Goal = (typeof PRIMARY_GOALS)[number];

interface Slot {
  pattern?: string;
  muscle?: string;
  role: 'main' | 'accessory';
  /** Какой по счёту вариант взять: 1 — второе лучшее упражнение, чтобы тренировки различались. */
  variant?: number;
}

interface Scheme {
  main: [number, number, number];
  acc: [number, number, number];
}

/** Повторы min, max и подходы для базовых и подсобных под цель (правила ТЗ). */
const SCHEMES: Record<Goal, Scheme> = {
  strength: { main: [3, 5, 4], acc: [6, 10, 3] },
  hypertrophy: { main: [6, 10, 3], acc: [10, 15, 3] },
  strength_hypertrophy: { main: [4, 6, 4], acc: [8, 12, 3] },
  fat_loss: { main: [5, 8, 3], acc: [10, 15, 2] },
  recomp: { main: [6, 8, 3], acc: [10, 12, 3] },
  general_fitness: { main: [6, 10, 3], acc: [10, 15, 2] },
};

const GOAL_TEXT: Record<Goal, string> = {
  strength: 'сила',
  hypertrophy: 'масса',
  strength_hypertrophy: 'сила и масса',
  fat_loss: 'сушка',
  recomp: 'рекомпозиция',
  general_fitness: 'общая форма',
};

const iso = (muscle: string, variant = 0): Slot => ({
  pattern: 'isolation',
  muscle,
  role: 'accessory',
  variant,
});
const main = (pattern: string, variant = 0): Slot => ({ pattern, role: 'main', variant });
const acc = (pattern: string, variant = 0): Slot => ({ pattern, role: 'accessory', variant });

type Zone = 'full' | 'upper' | 'lower' | 'push' | 'pull' | 'legs';

/** Какие мышцы уместно добивать изоляцией в тренировке этого типа. */
const ZONE_MUSCLES: Record<Zone, string[] | null> = {
  full: null,
  upper: ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'traps', 'abs'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'],
  push: ['chest', 'shoulders', 'triceps', 'abs'],
  pull: ['back', 'biceps', 'traps', 'forearms', 'abs'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'],
};

interface SplitDef {
  name: string;
  sessions: Array<{ key: string; title: string; zone: Zone; slots: Slot[] }>;
}

function splitFor(perWeek: number): SplitDef {
  if (perWeek <= 2) {
    return {
      name: 'Фулбади A/B',
      sessions: [
        {
          key: 'A',
          title: 'Фулбади A',
          zone: 'full',
          slots: [
            main('squat'),
            main('horizontal_push'),
            main('vertical_pull'),
            iso('hamstrings'),
            iso('shoulders'),
            acc('core'),
          ],
        },
        {
          key: 'B',
          title: 'Фулбади B',
          zone: 'full',
          slots: [
            main('hinge'),
            main('vertical_push'),
            main('horizontal_pull'),
            acc('single_leg'),
            iso('biceps'),
            iso('triceps'),
          ],
        },
      ],
    };
  }
  if (perWeek === 3) {
    return {
      name: 'Фулбади A/B/C',
      sessions: [
        {
          key: 'A',
          title: 'Фулбади A',
          zone: 'full',
          slots: [
            main('squat'),
            main('horizontal_push'),
            main('vertical_pull'),
            iso('hamstrings'),
            iso('shoulders'),
            acc('core'),
          ],
        },
        {
          key: 'B',
          title: 'Фулбади B',
          zone: 'full',
          slots: [
            main('hinge'),
            main('vertical_push'),
            main('horizontal_pull'),
            acc('single_leg'),
            iso('biceps'),
            iso('triceps'),
          ],
        },
        {
          key: 'C',
          title: 'Фулбади C',
          zone: 'full',
          slots: [
            main('squat', 1),
            main('horizontal_push', 1),
            main('horizontal_pull', 1),
            acc('hinge', 1),
            iso('chest'),
            iso('calves'),
          ],
        },
      ],
    };
  }
  if (perWeek === 4) {
    return {
      name: 'Верх/низ ×2',
      sessions: [
        {
          key: 'A',
          title: 'Верх 1',
          zone: 'upper',
          slots: [
            main('horizontal_push'),
            main('horizontal_pull'),
            acc('vertical_push'),
            acc('vertical_pull'),
            iso('biceps'),
            iso('triceps'),
          ],
        },
        {
          key: 'B',
          title: 'Низ 1',
          zone: 'lower',
          slots: [
            main('squat'),
            acc('hinge', 1),
            acc('single_leg'),
            iso('hamstrings'),
            iso('calves'),
            acc('core'),
          ],
        },
        {
          key: 'C',
          title: 'Верх 2',
          zone: 'upper',
          slots: [
            main('vertical_pull'),
            main('horizontal_push', 1),
            acc('horizontal_pull', 1),
            iso('shoulders'),
            iso('triceps', 1),
            iso('biceps', 1),
          ],
        },
        {
          key: 'D',
          title: 'Низ 2',
          zone: 'lower',
          slots: [
            main('hinge'),
            acc('squat', 1),
            acc('single_leg', 1),
            iso('quads'),
            iso('calves', 1),
            acc('core', 1),
          ],
        },
      ],
    };
  }
  return {
    name: 'Толкай/тяни/ноги',
    sessions: [
      {
        key: 'A',
        title: 'Толкай',
        zone: 'push',
        slots: [
          main('horizontal_push'),
          main('vertical_push'),
          acc('horizontal_push', 1),
          iso('shoulders'),
          iso('triceps'),
        ],
      },
      {
        key: 'B',
        title: 'Тяни',
        zone: 'pull',
        slots: [
          main('vertical_pull'),
          main('horizontal_pull'),
          acc('horizontal_pull', 1),
          iso('shoulders', 1),
          iso('biceps'),
        ],
      },
      {
        key: 'C',
        title: 'Ноги',
        zone: 'legs',
        slots: [
          main('squat'),
          main('hinge', 1),
          acc('single_leg'),
          iso('hamstrings'),
          iso('quads'),
          iso('calves'),
        ],
      },
    ],
  };
}

const TIER_ORDER = { S: 0, A: 1, B: 2 } as const;
const MINUTES_PER_SET = 2.5;
const WARMUP_MINUTES = 10;

/**
 * План без ИИ: сплит по частоте, лучшие доступные упражнения по паттернам,
 * подходы и повторы под цель, приоритетные мышцы — с добавочным объёмом,
 * тренировка укладывается в заданное время.
 */
export function buildRulesTemplate(
  card: AthleteCard,
  available: Exercise[],
  schedule: ScheduleInfo,
): BlockTemplate {
  const goal: Goal = card.goals?.primary ?? 'general_fitness';
  const scheme = SCHEMES[goal];
  const priority = new Set<string>(card.goals?.priorityMuscles ?? []);
  const minutes = card.availability?.sessionMinutes ?? 75;
  const split = splitFor(schedule.perWeek);
  const usedInBlock = new Set<string>();

  const pick = (slot: Slot, usedInSession: Set<string>): Exercise | undefined => {
    const candidates = available
      .filter(
        (e) =>
          (!slot.pattern || e.pattern === slot.pattern) &&
          (!slot.muscle || e.primaryMuscles.includes(slot.muscle)) &&
          (slot.role === 'accessory' || e.isCompound) &&
          !usedInSession.has(e.slug),
      )
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
    if (candidates.length === 0) return undefined;
    const fresh = candidates.filter((e) => !usedInBlock.has(e.slug));
    const pool = fresh.length > 0 ? fresh : candidates;
    return pool[Math.min(slot.variant ?? 0, pool.length - 1)];
  };

  const prescribe = (e: Exercise, role: Slot['role']): TemplateExercise => {
    const [min, max, sets] = role === 'main' ? scheme.main : scheme.acc;
    if (e.slug === 'plank')
      return { slug: e.slug, sets: 3, repsMin: 30, repsMax: 45, note: 'Секунды, а не повторы' };
    if (e.pattern === 'core') return { slug: e.slug, sets: 3, repsMin: 10, repsMax: 15 };
    const boost = e.primaryMuscles.some((m) => priority.has(m)) && role === 'accessory' ? 1 : 0;
    return { slug: e.slug, sets: Math.min(5, sets + boost), repsMin: min, repsMax: max };
  };

  const sessions: SessionTemplate[] = split.sessions.map((def) => {
    const used = new Set<string>();
    const exercises: TemplateExercise[] = [];
    for (const slot of def.slots) {
      const e = pick(slot, used);
      if (!e) continue;
      used.add(e.slug);
      usedInBlock.add(e.slug);
      exercises.push(prescribe(e, slot.role));
    }
    // Приоритетные мышцы: изоляция в каждой тренировке своего типа, где их ещё нет.
    const zoneMuscles = ZONE_MUSCLES[def.zone];
    for (const muscle of priority) {
      if (exercises.length >= 8) break;
      if (zoneMuscles && !zoneMuscles.includes(muscle)) continue;
      const covered = exercises.some((x) =>
        available.find((e) => e.slug === x.slug)?.primaryMuscles.includes(muscle),
      );
      if (covered) continue;
      const e = pick(iso(muscle), used) ?? pick({ muscle, role: 'accessory' }, used);
      if (!e) continue;
      used.add(e.slug);
      exercises.push(prescribe(e, 'accessory'));
    }
    return {
      key: def.key,
      title: def.title,
      exercises: fitIntoMinutes(exercises, minutes, available, priority),
    };
  });

  const nonEmpty = sessions.filter((s) => s.exercises.length >= 2);
  const usable = nonEmpty.length > 0 ? nonEmpty : [fallbackSession(available, scheme)];
  const weeks =
    goal === 'fat_loss'
      ? [
          { rir: 3, extraSets: 0 },
          { rir: 2, extraSets: 0 },
          { rir: 2, extraSets: 0 },
          { rir: 1, extraSets: 0 },
        ]
      : [
          { rir: 3, extraSets: 0 },
          { rir: 2, extraSets: 0 },
          { rir: 2, extraSets: 1 },
          { rir: 1, extraSets: 1 },
        ];

  const [mMin, mMax] = scheme.main;
  const [aMin, aMax] = scheme.acc;
  return {
    split: split.name,
    accumulationWeeks: 4,
    weeks,
    sessions: usable,
    rotation: usable.map((s) => s.key),
    rationale:
      `${split.name}: ${schedule.perWeek} ${schedule.perWeek === 1 ? 'тренировка' : schedule.perWeek < 5 ? 'тренировки' : 'тренировок'} в неделю, ` +
      `каждая мышца — не реже раза в неделю. Цель — ${GOAL_TEXT[goal]}: базовые ${mMin}–${mMax} повторов, подсобка ${aMin}–${aMax}. ` +
      `4 недели нагрузка растёт: запас повторов уходит с 3 до 1${goal === 'fat_loss' ? '' : ', на 3–4 неделе добавляется подход'}; 5-я неделя — разгрузка.` +
      (priority.size > 0 ? ' Приоритетные мышцы получают изоляцию и лишний подход.' : ''),
    coachNote: 'Записывай каждый подход и честно оценивай запас: по нему я поднимаю веса.',
  };
}

/** Укладывает тренировку во время: сначала режет неприоритетную подсобку с конца. */
function fitIntoMinutes(
  exercises: TemplateExercise[],
  minutes: number,
  available: Exercise[],
  priority: Set<string>,
): TemplateExercise[] {
  const result = [...exercises];
  const estimate = () =>
    result.reduce((sum, x) => sum + x.sets + 1, 0) * MINUTES_PER_SET + WARMUP_MINUTES;
  const isPriority = (x: TemplateExercise) =>
    available.find((e) => e.slug === x.slug)?.primaryMuscles.some((m) => priority.has(m)) ?? false;
  while (estimate() > minutes && result.length > 3) {
    const idx = findLastIndex(result, (x, i) => i >= 2 && !isPriority(x));
    if (idx === -1) break;
    result.splice(idx, 1);
  }
  return result;
}

function findLastIndex<T>(list: T[], fn: (item: T, index: number) => boolean): number {
  for (let i = list.length - 1; i >= 0; i -= 1) if (fn(list[i]!, i)) return i;
  return -1;
}

/** Если оборудования почти нет — хоть что-то из доступного. */
function fallbackSession(available: Exercise[], scheme: Scheme): SessionTemplate {
  const picks = [...available]
    .sort((a, b) => Number(b.isCompound) - Number(a.isCompound))
    .slice(0, 5);
  return {
    key: 'A',
    title: 'Тренировка A',
    exercises: picks.map((e) => ({
      slug: e.slug,
      sets: scheme.acc[2],
      repsMin: scheme.acc[0],
      repsMax: scheme.acc[1],
    })),
  };
}
