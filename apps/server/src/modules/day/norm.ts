import type { AthleteCard, DayNorm, WeightPoint, WeightTrend } from '@trektren/shared';
import { addDays, diffDays } from '../../dates.js';

/** Нижняя граница нормы по ТЗ: ниже тренер калории не опускает. */
export const KCAL_FLOOR = 1800;
/** Поправка по тренду за раз — не больше ±300 ккал (ТЗ). */
const MAX_SUGGESTION = 300;
/** Шаги, которые уже входят в «бытовую» базу BMR × 1,2. */
const BASE_STEPS = 3000;
/** ккал на шаг на кг веса: ~0,5 ккал/кг/км, ~1300 шагов на км. */
const KCAL_PER_STEP_PER_KG = 0.0005;
/** Силовая тренировка вместе с отдыхом между подходами. */
const TRAINING_MET = 4;

/** Коридор изменения веса за неделю под цель, % веса тела. */
export const TARGET_PCT: Record<string, [number, number]> = {
  hypertrophy: [0.25, 0.5],
  strength_hypertrophy: [0.1, 0.35],
  strength: [0, 0.3],
  recomp: [-0.25, 0.1],
  general_fitness: [-0.2, 0.2],
  fat_loss: [-1, -0.5],
};

/** Поправка к расходу под цель. */
const GOAL_FACTOR: Record<string, number> = {
  hypertrophy: 0.12,
  strength_hypertrophy: 0.1,
  strength: 0.08,
  recomp: 0,
  general_fitness: 0,
  fat_loss: -0.2,
};

export function ageOn(birthDate: string, date: string): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  const [ty, tm, td] = date.split('-').map(Number);
  return ty! - y! - (tm! < m! || (tm === m && td! < d!) ? 1 : 0);
}

export interface NormInput {
  card: AthleteCard;
  date: string;
  weightKg: number | null;
  steps: number | null;
  /** Минуты тренировки в этот день; null — дня отдыха. */
  trainingMinutes: number | null;
  adjust: number;
}

/**
 * Норма калорий и БЖУ на день (ТЗ): Миффлин-Сан Жеор × 1,2 как быт,
 * плюс шаги сверх 3000, плюс силовая тренировка, плюс поправка под цель и по тренду веса.
 */
export function computeNorm(input: NormInput): { norm: DayNorm | null; missing: string[] } {
  const { card, date, weightKg, trainingMinutes, adjust } = input;
  const basics = card.basics ?? {};
  const missing: string[] = [];
  if (!weightKg) missing.push('вес');
  if (!basics.heightCm) missing.push('рост');
  if (!basics.birthDate) missing.push('дата рождения');
  if (!basics.sex) missing.push('пол');
  if (missing.length > 0 || !weightKg) return { norm: null, missing };

  const age = ageOn(basics.birthDate!, date);
  const bmr =
    10 * weightKg + 6.25 * basics.heightCm! - 5 * age + (basics.sex === 'male' ? 5 : -161);
  const base = bmr * 1.2;

  let stepsSource: DayNorm['stepsSource'] = 'none';
  let steps = 0;
  if (input.steps !== null) {
    stepsSource = 'logged';
    steps = input.steps;
  } else if (card.activity?.avgSteps) {
    stepsSource = 'average';
    steps = card.activity.avgSteps;
  }
  const stepsKcal = Math.max(0, steps - BASE_STEPS) * weightKg * KCAL_PER_STEP_PER_KG;
  const training = trainingMinutes ? TRAINING_MET * weightKg * (trainingMinutes / 60) : 0;
  const expenditure = base + stepsKcal + training;
  const goal = expenditure * (GOAL_FACTOR[card.goals?.primary ?? 'general_fitness'] ?? 0);

  const raw = expenditure + goal + adjust;
  const kcal = round10(Math.max(KCAL_FLOOR, raw));
  const proteinG = Math.round(weightKg * (card.goals?.primary === 'fat_loss' ? 2.2 : 2));
  const fatG = Math.round(weightKg * 0.9);
  const carbsG = Math.max(0, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));

  return {
    norm: {
      kcal,
      proteinG,
      fatG,
      carbsG,
      parts: {
        bmr: Math.round(bmr),
        base: Math.round(base),
        steps: Math.round(stepsKcal),
        training: Math.round(training),
        goal: Math.round(goal),
        adjust,
      },
      stepsSource,
      trainingDay: Boolean(trainingMinutes),
      weightKg,
      floorApplied: raw < KCAL_FLOOR,
    },
    missing: [],
  };
}

const round10 = (n: number) => Math.round(n / 10) * 10;
const round50 = (n: number) => Math.round(n / 50) * 50;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number, sign = false) =>
  `${sign && n > 0 ? '+' : ''}${String(n).replace('.', ',').replace('-', '−')}`;

export interface WeightRow {
  date: string;
  time_of_day: 'morning' | 'evening';
  weight_kg: number;
}

/**
 * Тренд по утреннему весу: средняя за 7 дней (если в окне 3+ взвешивания),
 * изменение за неделю против коридора цели и поправка калорий, если темп мимо.
 */
export function computeTrend(input: {
  rows: WeightRow[];
  today: string;
  goal: string;
  lastAdjustAt: string | null;
}): WeightTrend {
  const { rows, today, goal } = input;
  const morning = new Map<string, number>();
  const evening = new Map<string, number>();
  for (const r of rows) (r.time_of_day === 'morning' ? morning : evening).set(r.date, r.weight_kg);

  const avgAt = (date: string): number | null => {
    const vals: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const v = morning.get(addDays(date, -i));
      if (v !== undefined) vals.push(v);
    }
    return vals.length >= 3 ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };

  const points: WeightPoint[] = [];
  for (let i = 27; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    points.push({
      date,
      morning: morning.get(date) ?? null,
      evening: evening.get(date) ?? null,
      avg7: avgAt(date),
    });
  }

  // Сегодня ещё не взвешивался — берём последний день с данными за 3 дня.
  let ref = today;
  for (let i = 0; i < 3 && avgAt(ref) === null; i += 1) ref = addDays(ref, -1);
  const avg7 = avgAt(ref);
  const prev = avgAt(addDays(ref, -7));
  const targetPct = TARGET_PCT[goal] ?? TARGET_PCT.general_fitness!;

  const deltas = [...evening.entries()]
    .filter(([d]) => morning.has(d) && diffDays(d, today) < 14)
    .map(([d, v]) => v - morning.get(d)!);
  const eveningDelta =
    deltas.length > 0 ? r1(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null;

  const base = { avg7, targetPct, eveningDelta, points };
  if (avg7 === null || prev === null) {
    const count = [...morning.keys()].filter((d) => diffDays(d, today) < 14).length;
    return {
      ...base,
      weeklyChangeKg: null,
      weeklyChangePct: null,
      verdict: 'not_enough_data',
      text: `Взвешивайся каждое утро натощак, после туалета — через 10 дней будет тренд. Утренних взвешиваний за 2 недели: ${count}.`,
      kcalSuggestion: 0,
    };
  }

  const changeKg = r2(avg7 - prev);
  const pct = r2((changeKg / prev) * 100);
  const [lo, hi] = targetPct;
  const head = `За неделю ${fmt(changeKg, true)} кг (${fmt(pct, true)}% веса), цель ${fmt(lo, true)}…${fmt(hi, true)}% в неделю.`;

  if (pct >= lo && pct <= hi) {
    return {
      ...base,
      weeklyChangeKg: changeKg,
      weeklyChangePct: pct,
      verdict: 'on_track',
      text: `${head} В коридоре — калории не трогаем.`,
      kcalSuggestion: 0,
    };
  }

  const below = pct < lo;
  const gap = below ? lo - pct : hi - pct; // в процентах веса
  let kcal = round50(((gap / 100) * avg7 * 7700) / 7);
  kcal = Math.max(-MAX_SUGGESTION, Math.min(MAX_SUGGESTION, kcal));
  if (Math.abs(kcal) < 50) kcal = below ? 50 : -50;

  const gaining = lo > 0;
  const cutting = hi < 0;
  const why = below
    ? gaining
      ? 'Набор медленнее цели.'
      : cutting
        ? 'Худеешь быстрее цели — так уходят мышцы и сила.'
        : 'Вес уходит вниз.'
    : gaining
      ? 'Набор быстрее цели — лишнее пойдёт в жир.'
      : cutting
        ? 'Худеешь медленнее цели.'
        : 'Вес растёт.';

  const recent =
    input.lastAdjustAt !== null && diffDays(input.lastAdjustAt, today) < 7
      ? input.lastAdjustAt
      : null;
  return {
    ...base,
    weeklyChangeKg: changeKg,
    weeklyChangePct: pct,
    verdict: below ? 'too_slow' : 'too_fast',
    text: recent
      ? `${head} ${why} Норму поправили недавно — ждём неделю, прежде чем менять снова.`
      : `${head} ${why} Предлагаю ${fmt(kcal, true)} ккал в день.`,
    kcalSuggestion: recent ? 0 : kcal,
  };
}
