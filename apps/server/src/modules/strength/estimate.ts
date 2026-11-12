import type { AthleteCard } from '@trektren/shared';
import type { Exercise } from '../exercises/repo.js';

/** Опорные движения: от их максимумов считаются веса во всех остальных упражнениях. */
export const ANCHORS = [
  'barbell-back-squat',
  'deadlift',
  'bench-press',
  'overhead-press',
  'barbell-row',
] as const;
export type Anchor = (typeof ANCHORS)[number];

/**
 * Если опорного максимума нет, берём его из другого опорного по типичному соотношению.
 * Порядок — от самого надёжного.
 */
const FALLBACKS: Record<Anchor, Array<[Anchor, number]>> = {
  'barbell-back-squat': [
    ['deadlift', 0.8],
    ['bench-press', 1.25],
  ],
  deadlift: [
    ['barbell-back-squat', 1.2],
    ['bench-press', 1.5],
  ],
  'bench-press': [
    ['barbell-back-squat', 0.75],
    ['deadlift', 0.6],
  ],
  'overhead-press': [['bench-press', 0.62]],
  'barbell-row': [['bench-press', 0.85]],
};

/** Максимум в долях веса тела по стажу — когда силовых данных нет совсем. Мужчины. */
const BODYWEIGHT_STANDARDS: Array<{ maxYears: number; ratios: Record<Anchor, number> }> = [
  {
    maxYears: 1,
    ratios: {
      'barbell-back-squat': 1,
      deadlift: 1.25,
      'bench-press': 0.75,
      'overhead-press': 0.45,
      'barbell-row': 0.6,
    },
  },
  {
    maxYears: 3,
    ratios: {
      'barbell-back-squat': 1.4,
      deadlift: 1.75,
      'bench-press': 1,
      'overhead-press': 0.6,
      'barbell-row': 0.8,
    },
  },
  {
    maxYears: Infinity,
    ratios: {
      'barbell-back-squat': 1.75,
      deadlift: 2.1,
      'bench-press': 1.25,
      'overhead-press': 0.75,
      'barbell-row': 1,
    },
  },
];
const FEMALE_FACTOR: Record<Anchor, number> = {
  'barbell-back-squat': 0.7,
  deadlift: 0.7,
  'bench-press': 0.55,
  'overhead-press': 0.55,
  'barbell-row': 0.6,
};

export interface MaxEstimate {
  oneRmKg: number;
  /** own — своё значение из карточки, ratio — через соотношение, bodyweight — по весу тела. */
  basis: 'own' | 'ratio' | 'bodyweight';
  /** От какого упражнения посчитано. */
  fromSlug?: string;
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Максимумы по всем упражнениям: свои значения из карточки, остальное — через
 * опорные движения. Ничего не придумываем там, где есть данные человека.
 */
export function estimateMaxes(card: AthleteCard, exercises: Exercise[]): Map<string, MaxEstimate> {
  const result = new Map<string, MaxEstimate>();
  for (const [slug, lift] of Object.entries(card.strength?.lifts ?? {})) {
    if (lift.oneRmKg > 0) result.set(slug, { oneRmKg: lift.oneRmKg, basis: 'own' });
  }

  for (const anchor of ANCHORS) {
    if (result.has(anchor)) continue;
    const fallback = FALLBACKS[anchor].find(([from]) => result.get(from)?.basis === 'own');
    if (fallback) {
      const [from, ratio] = fallback;
      result.set(anchor, {
        oneRmKg: round(result.get(from)!.oneRmKg * ratio),
        basis: 'ratio',
        fromSlug: from,
      });
    }
  }

  const bodyweightKg = card.basics?.weightKg;
  if (bodyweightKg) {
    const years = card.experience?.trainingYears ?? 0;
    const standard = BODYWEIGHT_STANDARDS.find((s) => years < s.maxYears)!;
    for (const anchor of ANCHORS) {
      if (result.has(anchor)) continue;
      const factor = card.basics?.sex === 'female' ? FEMALE_FACTOR[anchor] : 1;
      result.set(anchor, {
        oneRmKg: round(bodyweightKg * standard.ratios[anchor] * factor),
        basis: 'bodyweight',
      });
    }
  }

  for (const e of exercises) {
    if (result.has(e.slug) || !e.refSlug || !e.refRatio) continue;
    const ref = result.get(e.refSlug);
    if (!ref) continue;
    result.set(e.slug, {
      oneRmKg: round(ref.oneRmKg * e.refRatio),
      basis: ref.basis === 'bodyweight' ? 'bodyweight' : 'ratio',
      fromSlug: e.refSlug,
    });
  }
  return result;
}
