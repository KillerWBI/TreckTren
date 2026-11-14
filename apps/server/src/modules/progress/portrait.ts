import {
  MUSCLE_GROUPS,
  type AthleteCard,
  type BodyZone,
  type MuscleGroup,
  type PortraitBody,
  type PortraitResponse,
} from '@trektren/shared';
import { addDays } from '../../dates.js';
import { pool } from '../../db.js';
import { getCard } from '../card/service.js';
import { ageOn } from '../day/norm.js';
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

function liftLevel(slug: string, oneRmKg: number, weightKg: number, female: boolean): number {
  const table = STANDARDS[slug]!.map((t) => t * (female ? FEMALE[slug]! : 1));
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
  [/жим стоя|армейск|дельт|плеч/, ['shoulders']],
  [/жим|груд/, ['chest', 'triceps']],
  [/спин|широч|тяг/, ['back']],
  [/трицепс/, ['triceps']],
  [/бицепс|рук/, ['biceps']],
  [/пресс|кор/, ['abs']],
  [/икр/, ['calves']],
  [/ягодиц/, ['glutes']],
];

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

const STRENGTH_LABELS: Array<[number, string]> = [
  [0.15, 'новичок'],
  [0.4, 'начальный уровень'],
  [0.6, 'средний уровень'],
  [0.8, 'продвинутый'],
  [1.01, 'сильный'],
];

export async function getPortrait(userId: string): Promise<PortraitResponse> {
  const today = await userToday(userId);
  const [{ card }, weights, first] = await Promise.all([
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

  const weakText = (card.weakPoints ?? [])
    .filter((w) => w.status !== 'resolved')
    .map((w) => `${w.area} ${w.cause ?? ''}`.toLowerCase());
  const weak = new Set<MuscleGroup>();
  for (const text of weakText) {
    const hit = WEAK_MAP.find(([re]) => re.test(text));
    hit?.[1].forEach((m) => weak.add(m));
  }

  const injuries = (card.limitations?.injuries ?? []).flatMap((i) => {
    const text = `${i.area} ${i.description}`.toLowerCase();
    const zone = ZONES.find(([re]) => re.test(text))?.[1];
    return zone ? [{ zone, area: i.area }] : [];
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
    strengthLabel: mean === null ? null : STRENGTH_LABELS.find(([max]) => mean < max)![1],
    priority: (card.goals?.priorityMuscles ?? []) as MuscleGroup[],
    weak: [...weak],
    injuries,
    completeness: { filled, total: sections.length },
    start,
  };
}
