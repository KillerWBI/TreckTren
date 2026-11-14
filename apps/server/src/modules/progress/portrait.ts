import {
  MUSCLE_GROUPS,
  type AthleteCard,
  type BodyZone,
  type MuscleDetail,
  type MuscleExercise,
  type MuscleGroup,
  type MuscleLift,
  type MuscleStatus,
  type PlannedSession,
  type PortraitBody,
  type PortraitResponse,
} from '@trektren/shared';
import { addDays } from '../../dates.js';
import { pool } from '../../db.js';
import { getCard } from '../card/service.js';
import { ageOn } from '../day/norm.js';
import { loadExercises, type Exercise } from '../exercises/repo.js';
import { filterAvailable } from '../plan/availability.js';
import { loadFor } from '../plan/loads.js';
import { estimateMaxes } from '../strength/estimate.js';
import { userToday } from '../strength/service.js';

/**
 * Силовые нормативы (мужчины), максимум в долях веса тела:
 * без подготовки, новичок, средний, продвинутый, элита → уровень 0, ¼, ½, ¾, 1.
 */
const STANDARDS: Record<string, number[]> = {
  'barbell-back-squat': [0.75, 1.25, 1.5, 2, 2.5],
  'bench-press': [0.5, 0.75, 1, 1.5, 2],
  deadlift: [1, 1.5, 2, 2.5, 3],
  'overhead-press': [0.35, 0.55, 0.75, 1, 1.25],
  'barbell-row': [0.5, 0.75, 1, 1.25, 1.5],
};
/** Женщинам нормативы ниже: верх сильнее, чем низ. */
const FEMALE: Record<string, number> = {
  'barbell-back-squat': 0.75,
  'bench-press': 0.6,
  deadlift: 0.75,
  'overhead-press': 0.6,
  'barbell-row': 0.65,
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

const tableFor = (slug: string, female: boolean) =>
  STANDARDS[slug]!.map((t) => t * (female ? FEMALE[slug]! : 1));

/** Ступени нормативов по порогам таблицы. */
const TIERS = ['начальный', 'любитель', 'средний', 'продвинутый', 'элита'];

/** Уровень 0…1 → максимум в долях веса тела (обратное к liftLevel). */
export function ratioForLevel(slug: string, level: number, female: boolean): number {
  const table = tableFor(slug, female);
  const x = clamp01(level) * 4;
  const i = Math.min(3, Math.floor(x));
  return table[i]! + (x - i) * (table[i + 1]! - table[i]!);
}

export function liftLevel(
  slug: string,
  oneRmKg: number,
  weightKg: number,
  female: boolean,
): number {
  const table = tableFor(slug, female);
  const ratio = oneRmKg / weightKg;
  if (ratio <= table[0]!) return clamp01((ratio / table[0]!) * 0.1);
  for (let i = 1; i < table.length; i += 1) {
    if (ratio <= table[i]!) {
      const t = (ratio - table[i - 1]!) / (table[i]! - table[i - 1]!);
      return r2((i - 1 + t) / 4);
    }
  }
  return 1;
}

const avg = (values: Array<number | null | undefined>): number | null => {
  const v = values.filter((x): x is number => typeof x === 'number');
  return v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

/** Мышцы по базовым движениям: какое движение что развивает. */
export function muscleLevels(
  card: AthleteCard,
  weightKg: number,
): Record<MuscleGroup, number | null> {
  const lifts = card.strength?.lifts ?? {};
  const female = card.basics?.sex === 'female';
  const lv = (slug: string) => {
    const l = lifts[slug];
    return l && l.oneRmKg > 0 ? liftLevel(slug, l.oneRmKg, weightKg, female) : null;
  };
  const squat = lv('barbell-back-squat');
  const bench = lv('bench-press');
  const dead = lv('deadlift');
  const ohp = lv('overhead-press');
  const row = lv('barbell-row');
  const shoulders = ohp ?? (bench !== null ? r2(bench * 0.9) : null);
  const back = avg([row, dead]);
  return {
    chest: bench,
    shoulders,
    triceps: avg([bench, ohp]),
    back,
    traps: dead ?? back,
    biceps: row ?? back,
    forearms: dead ?? row,
    quads: squat,
    glutes: avg([squat, dead]),
    hamstrings: dead,
    calves: squat !== null ? r2(squat * 0.85) : null,
    abs: avg([squat, bench, dead, ohp, row]),
  };
}

/** Процент жира по ИМТ и возрасту (Деуренберг), если не введён. */
export function estimateBodyFat(bmi: number, age: number, female: boolean): number {
  return Math.round(
    Math.min(45, Math.max(5, 1.2 * bmi + 0.23 * age - 10.8 * (female ? 0 : 1) - 5.4)),
  );
}

const ZONES: Array<[RegExp, BodyZone]> = [
  [/колен/, 'knee'],
  [/поясн|спин|грыж|протруз/, 'lowerBack'],
  [/плеч|ротатор/, 'shoulder'],
  [/лок[оо]т|локт/, 'elbow'],
  [/запяст|кист/, 'wrist'],
  [/голеностоп|лодыж|ахилл|стоп/, 'ankle'],
  [/тазобедр|бедр|паховая|пах/, 'hip'],
  [/ше[ия]|шейн/, 'neck'],
  [/груд/, 'chest'],
];

/** Слабое место словами → мышцы: «присед» — квадрицепсы, «жим» — грудь и трицепс… */
const WEAK_MAP: Array<[RegExp, MuscleGroup[]]> = [
  [/присед|квадри|ног/, ['quads', 'glutes']],
  [/станов|тяга с пола|задн|бицепс бедр/, ['hamstrings', 'back']],
  [/жим[а-яё ]{0,20}стоя|армейск|дельт|плеч|над голов/, ['shoulders']],
  [/жим|груд/, ['chest', 'triceps']],
  [/спин|широч|тяг/, ['back']],
  [/трицепс/, ['triceps']],
  [/бицепс|рук/, ['biceps']],
  [/пресс|кор/, ['abs']],
  [/икр/, ['calves']],
  [/ягодиц/, ['glutes']],
];

/* Подробно по мышцам ---------------------------------------------------- */

const MUSCLE_NAMES: Record<MuscleGroup, string> = {
  chest: 'Грудь',
  back: 'Спина',
  shoulders: 'Плечи',
  biceps: 'Бицепс',
  triceps: 'Трицепс',
  forearms: 'Предплечья',
  traps: 'Трапеции',
  abs: 'Пресс',
  quads: 'Квадрицепс',
  hamstrings: 'Бицепс бедра',
  glutes: 'Ягодицы',
  calves: 'Икры',
};
const PLURAL = new Set<MuscleGroup>(['shoulders', 'forearms', 'traps', 'glutes', 'calves']);

/** По каким базовым движениям судим о мышце. proxy — своего теста нет. */
const MUSCLE_LIFTS: Record<MuscleGroup, { lifts: string[]; proxy: boolean }> = {
  chest: { lifts: ['bench-press'], proxy: false },
  shoulders: { lifts: ['overhead-press'], proxy: false },
  triceps: { lifts: ['bench-press', 'overhead-press'], proxy: false },
  back: { lifts: ['barbell-row', 'deadlift'], proxy: false },
  traps: { lifts: ['deadlift'], proxy: true },
  biceps: { lifts: ['barbell-row'], proxy: true },
  forearms: { lifts: ['deadlift'], proxy: true },
  quads: { lifts: ['barbell-back-squat'], proxy: false },
  glutes: { lifts: ['barbell-back-squat', 'deadlift'], proxy: false },
  hamstrings: { lifts: ['deadlift'], proxy: false },
  calves: { lifts: ['barbell-back-squat'], proxy: true },
  abs: {
    lifts: ['barbell-back-squat', 'bench-press', 'deadlift', 'overhead-press', 'barbell-row'],
    proxy: true,
  },
};

/** Травма → мышцы вокруг неё. */
const ZONE_MUSCLES: Record<BodyZone, MuscleGroup[]> = {
  neck: ['traps'],
  shoulder: ['shoulders', 'chest', 'triceps'],
  elbow: ['biceps', 'triceps', 'forearms'],
  wrist: ['forearms'],
  chest: ['chest'],
  lowerBack: ['back', 'glutes', 'hamstrings'],
  hip: ['glutes', 'quads'],
  knee: ['quads', 'hamstrings', 'calves'],
  ankle: ['calves'],
};

/** Уровень 0…1 → ступень нормативов: 0 — начальный, ¼ — любитель, ½ — средний, ¾ — продвинутый, 1 — элита. */
export function levelWord(level: number | null): string {
  if (level === null) return 'нет данных';
  return TIERS[Math.min(4, Math.floor(level * 4 + 1e-9))]!;
}

const ceil25 = (kg: number) => Math.ceil(kg / 2.5) * 2.5;

interface DetailInput {
  card: AthleteCard;
  body: PortraitBody;
  exercises: Exercise[];
  inPlan: Set<string>;
  weak: Map<MuscleGroup, { area: string; cause: string | null }>;
  injuries: Array<{ zone: BodyZone; area: string; description: string }>;
}

function liftInfo(slug: string, input: DetailInput, names: Map<string, string>): MuscleLift {
  const { card, body } = input;
  const female = body.sex === 'female';
  const lift = card.strength?.lifts?.[slug];
  const goalKg = card.strength?.targets?.[slug] ?? null;
  const name = names.get(slug) ?? slug;
  if (!lift || lift.oneRmKg <= 0) {
    return { slug, name, oneRmKg: null, source: null, ratio: null, tier: null, next: null, goalKg };
  }
  const table = tableFor(slug, female);
  const ratio = lift.oneRmKg / body.weightKg;
  const reached = table.filter((t) => ratio >= t).length;
  const nextIdx = table.findIndex((t) => t > ratio);
  return {
    slug,
    name,
    oneRmKg: lift.oneRmKg,
    source: lift.testedKg ? 'tested' : lift.working ? 'working' : 'estimated',
    ratio: r2(ratio),
    tier: reached === 0 ? 'ниже начального' : TIERS[reached - 1]!,
    next:
      nextIdx === -1
        ? null
        : {
            tier: TIERS[nextIdx]!,
            ratio: r2(table[nextIdx]!),
            kg: ceil25(table[nextIdx]! * body.weightKg),
          },
    goalKg,
  };
}

/** Главные упражнения на мышцу, убранные из-за травмы: показать, что они есть, но не сейчас. */
function blockedFor(group: MuscleGroup, input: DetailInput): string[] {
  const { excluded } = filterAvailable(input.exercises, input.card);
  const bySlug = new Map(input.exercises.map((e) => [e.slug, e]));
  const rank = { S: 0, A: 1, B: 2 } as const;
  return excluded
    .filter((x) => x.reason === 'injury')
    .map((x) => bySlug.get(x.slug)!)
    .filter((e) => e.primaryMuscles.includes(group))
    .sort((a, b) => rank[a.tier] - rank[b.tier] || Number(b.isCompound) - Number(a.isCompound))
    .map((e) => e.name)
    .slice(0, 6);
}

function exercisesFor(group: MuscleGroup, input: DetailInput): MuscleExercise[] {
  const maxes = estimateMaxes(input.card, input.exercises);
  const { available } = filterAvailable(input.exercises, input.card);
  const tierRank = { S: 0, A: 1, B: 2 } as const;
  const scored = available
    .filter((e) => e.primaryMuscles.includes(group) || e.secondaryMuscles.includes(group))
    .map((e) => ({
      e,
      primary: e.primaryMuscles.includes(group),
      inPlan: input.inPlan.has(e.slug),
    }))
    .sort(
      (a, b) =>
        Number(b.inPlan) - Number(a.inPlan) ||
        Number(b.primary) - Number(a.primary) ||
        tierRank[a.e.tier] - tierRank[b.e.tier] ||
        Number(b.e.isCompound) - Number(a.e.isCompound),
    );
  const primaries = scored.filter((x) => x.primary);
  const list = (primaries.length >= 3 ? primaries : scored).slice(0, 6);
  return list.map(({ e, primary, inPlan }) => {
    const load = loadFor(
      { slug: e.slug, sets: 3, repsMin: 8, repsMax: 10, rir: 2, loadFactor: 1 },
      e,
      maxes.get(e.slug),
      { dumbbellMaxKg: input.card.equipment?.dumbbellMaxKg },
    );
    return {
      slug: e.slug,
      name: e.name,
      primary,
      inPlan,
      workKg: load.kind === 'kg' ? load.kg : null,
      perHand: load.kind === 'kg' ? load.perHand : false,
      kind: load.kind,
    };
  });
}

/** Статус, цели и упражнения по каждой мышце — то, что видно по нажатию на портрете. */
export function muscleDetails(input: DetailInput): {
  muscles: MuscleDetail[];
  median: number | null;
} {
  const { body, card } = input;
  const female = body.sex === 'female';
  const names = new Map(input.exercises.map((e) => [e.slug, e.name]));
  const lifts = card.strength?.lifts ?? {};
  const liftLv = (slug: string) => {
    const l = lifts[slug];
    return l && l.oneRmKg > 0 ? liftLevel(slug, l.oneRmKg, body.weightKg, female) : null;
  };
  // С чем сравниваем: средний уровень по мышцам, у которых есть свой тест.
  const own = MUSCLE_GROUPS.filter((m) => !MUSCLE_LIFTS[m].proxy)
    .map((m) => body.levels[m])
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const median = own.length ? r2(own[Math.floor((own.length - 1) / 2)]!) : null;
  const priority = new Set(card.goals?.priorityMuscles ?? []);

  const muscles = MUSCLE_GROUPS.map((group): MuscleDetail => {
    const name = MUSCLE_NAMES[group];
    const many = PLURAL.has(group);
    const { lifts: slugs, proxy } = MUSCLE_LIFTS[group];
    const level = body.levels[group];
    const liftViews = slugs.map((slug) => liftInfo(slug, input, names));
    const known = slugs
      .map((slug) => ({ slug, lv: liftLv(slug) }))
      .filter((x): x is { slug: string; lv: number } => x.lv !== null);
    // Для оценки через базовые движения сравниваем сами движения, а не пересчёт на мышцу.
    const statusLevel =
      level === null ? null : proxy ? known.reduce((a, x) => a + x.lv, 0) / known.length : level;
    const weak = input.weak.get(group) ?? null;
    let status: MuscleStatus = 'good';
    if (weak) status = 'weak';
    else if (statusLevel === null) status = 'unknown';
    else if (median !== null && statusLevel < median - 0.2) status = 'weak';
    else if (median !== null && statusLevel < median - 0.08) status = 'behind';

    let catchUp: MuscleDetail['catchUp'] = null;
    if ((status === 'behind' || status === 'weak') && median !== null && known.length) {
      const lowest = known.reduce((a, b) => (b.lv < a.lv ? b : a));
      const current = lifts[lowest.slug]!.oneRmKg;
      const kg = ceil25(ratioForLevel(lowest.slug, median, female) * body.weightKg);
      if (kg > current) {
        catchUp = {
          slug: lowest.slug,
          name: names.get(lowest.slug) ?? lowest.slug,
          kg,
          gapKg: Math.round((kg - current) * 10) / 10,
        };
      }
    }

    const injury = input.injuries.find((i) => ZONE_MUSCLES[i.zone].includes(group));
    // Коротко, почему такой цвет. Цифры, цель и упражнения — отдельными блоками.
    const parts: string[] = [];
    if (status === 'unknown') {
      parts.push(
        `Нет данных: впиши максимум или рабочий подход — ${slugs
          .slice(0, 2)
          .map((x) => names.get(x) ?? x)
          .join(' или ')
          .toLowerCase()} — или запиши тренировку с ним.`,
      );
    } else if (status === 'good' && own.length < 2) {
      parts.push(
        `${name}: ступень «${levelWord(level)}». Сравнить с остальным телом пока не с чем — впиши максимумы в других базовых движениях.`,
      );
    } else if (status === 'good') {
      parts.push(`${name} в норме — на уровне остального тела или сильнее.`);
    } else if (weak) {
      parts.push(`Отмечено слабым местом: «${weak.area}»${weak.cause ? ` — ${weak.cause}` : ''}.`);
    } else {
      parts.push(
        `${name} ${status === 'weak' ? (many ? 'заметно отстают' : 'заметно отстаёт') : many ? 'немного отстают' : 'немного отстаёт'} от остального тела.`,
      );
    }
    if (proxy && status !== 'unknown')
      parts.push('Оценка через базовые движения: отдельного теста на эту мышцу нет.');

    return {
      group,
      level,
      status,
      proxy,
      levelWord: levelWord(level),
      priority: priority.has(group),
      weak,
      injury: injury ? `${injury.area}: ${injury.description}` : null,
      lifts: liftViews,
      catchUp,
      summary: parts.join(' '),
      exercises: exercisesFor(group, input),
      blockedByInjury: injury ? blockedFor(group, input) : [],
    };
  });
  return { muscles, median };
}

function bodyOf(card: AthleteCard, weightKg: number, date: string): PortraitBody {
  const female = card.basics?.sex === 'female';
  const heightCm = card.basics?.heightCm ?? (female ? 165 : 178);
  const age = card.basics?.birthDate ? ageOn(card.basics.birthDate, date) : 30;
  const bmi = weightKg / (heightCm / 100) ** 2;
  return {
    sex: female ? 'female' : 'male',
    heightCm,
    weightKg,
    bodyFatPct: card.basics?.bodyFatPct ?? estimateBodyFat(bmi, age, female),
    bodyFatEstimated: card.basics?.bodyFatPct === undefined,
    levels: muscleLevels(card, weightKg),
  };
}

export async function getPortrait(userId: string): Promise<PortraitResponse> {
  const today = await userToday(userId);
  const [{ card }, weights, first, exercises, upcoming] = await Promise.all([
    getCard(userId),
    pool.query<{ date: string; weight_kg: number }>(
      `SELECT date, weight_kg FROM weight_logs
       WHERE user_id = $1 AND time_of_day = 'morning' AND date > $2 ORDER BY date DESC`,
      [userId, addDays(today, -14)],
    ),
    // Начало пути: первая версия карточки, где уже были рост и вес.
    pool.query<{ snapshot: AthleteCard; created_at: Date }>(
      `SELECT snapshot, created_at FROM card_versions
       WHERE user_id = $1 AND snapshot->'basics' ? 'weightKg' AND snapshot->'basics' ? 'heightCm'
       ORDER BY version LIMIT 1`,
      [userId],
    ),
    loadExercises(),
    pool.query<{ planned_json: PlannedSession }>(
      'SELECT planned_json FROM scheduled_sessions WHERE user_id = $1 AND date >= $2',
      [userId, today],
    ),
  ]);

  // Вес: средняя за 7 дней по утрам, если взвешиваний 3+, иначе последнее, иначе карточка.
  const lastWeek = weights.rows.filter((r) => r.date > addDays(today, -7));
  let weightSource: PortraitResponse['weightSource'] = 'default';
  let weightKg = card.basics?.sex === 'female' ? 62 : 75;
  if (lastWeek.length >= 3) {
    weightKg = r2(lastWeek.reduce((a, r) => a + r.weight_kg, 0) / lastWeek.length);
    weightSource = 'average';
  } else if (weights.rows[0]) {
    weightKg = weights.rows[0].weight_kg;
    weightSource = 'log';
  } else if (card.basics?.weightKg) {
    weightKg = card.basics.weightKg;
    weightSource = 'card';
  }

  const body = bodyOf(card, weightKg, today);
  const known = MUSCLE_GROUPS.map((m) => body.levels[m]).filter((v): v is number => v !== null);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;

  const weakBy = new Map<MuscleGroup, { area: string; cause: string | null }>();
  for (const w of (card.weakPoints ?? []).filter((x) => x.status !== 'resolved')) {
    // Сначала по названию слабого места, причина — только если название ничего не дало.
    const area = w.area.toLowerCase();
    const cause = (w.cause ?? '').toLowerCase();
    const hit = WEAK_MAP.find(([re]) => re.test(area)) ?? WEAK_MAP.find(([re]) => re.test(cause));
    for (const m of hit?.[1] ?? []) {
      if (!weakBy.has(m))
        weakBy.set(m, { area: w.area, cause: w.cause?.trim().replace(/[.!]+$/, '') || null });
    }
  }
  const weak = new Set(weakBy.keys());

  const injuryZones = (card.limitations?.injuries ?? []).flatMap((i) => {
    const text = `${i.area} ${i.description}`.toLowerCase();
    const zone = ZONES.find(([re]) => re.test(text))?.[1];
    return zone ? [{ zone, area: i.area, description: i.description }] : [];
  });
  const injuries = injuryZones.map(({ zone, area }) => ({ zone, area }));
  const inPlan = new Set(upcoming.rows.flatMap((r) => r.planned_json.exercises.map((e) => e.slug)));
  const details = muscleDetails({
    card,
    body,
    exercises,
    inPlan,
    weak: weakBy,
    injuries: injuryZones,
  });

  const sections = [
    'basics',
    'goals',
    'availability',
    'equipment',
    'limitations',
    'experience',
    'activity',
    'nutrition',
    'recovery',
    'weakPoints',
    'strength',
  ] as const;
  const filled = sections.filter((s) => {
    const v = card[s];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === 'object' && v !== null && Object.keys(v).length > 0;
  }).length;

  const firstRow = first.rows[0];
  const start = firstRow
    ? {
        date: firstRow.created_at.toISOString().slice(0, 10),
        body: bodyOf(
          firstRow.snapshot,
          firstRow.snapshot.basics!.weightKg!,
          firstRow.created_at.toISOString().slice(0, 10),
        ),
      }
    : null;

  return {
    body,
    weightSource,
    bmi: Math.round((weightKg / (body.heightCm / 100) ** 2) * 10) / 10,
    age: card.basics?.birthDate ? ageOn(card.basics.birthDate, today) : null,
    strengthLabel: mean === null ? null : levelWord(mean),
    priority: (card.goals?.priorityMuscles ?? []) as MuscleGroup[],
    weak: [...weak],
    injuries,
    completeness: { filled, total: sections.length },
    start,
    muscles: details.muscles,
    medianLevel: details.median,
  };
}
