import { weightForReps, type LoadView, type PlannedExercise } from '@trektren/shared';
import type { Exercise } from '../exercises/repo.js';
import type { MaxEstimate } from '../strength/estimate.js';

const BAR_KG = 20;

export interface LoadOptions {
  /** Самая тяжёлая гантель в зале человека. */
  dumbbellMaxKg?: number | undefined;
}

/**
 * Вес на подход: середина диапазона повторов плюс запас, обратная формула Эпли от максимума
 * (своего или посчитанного через опорное движение), вниз до шага снаряда.
 * Блоки и тренажёры не считаем: стеки в каждом зале разные.
 */
export function loadFor(
  planned: PlannedExercise,
  exercise: Exercise | undefined,
  max: MaxEstimate | undefined,
  options: LoadOptions = {},
): LoadView {
  const perHand = exercise?.perHand ?? false;
  if (planned.targetKg) {
    return {
      kind: 'kg',
      kg: planned.targetKg,
      oneRmKg: planned.targetKg,
      basis: 'target',
      perHand,
    };
  }
  if (exercise?.bodyweight) return { kind: 'bodyweight' };
  if (exercise?.stack && max?.basis !== 'own') return { kind: 'calibrate', reason: 'stack' };
  if (!max) return { kind: 'calibrate', reason: 'no_data' };

  const reps = Math.ceil((planned.repsMin + planned.repsMax) / 2);
  const raw = weightForReps(max.oneRmKg, reps, planned.rir) * planned.loadFactor;
  const step = exercise?.weightStepKg ?? 2.5;
  let kg = Math.max(step, Math.floor(raw / step) * step);
  if (exercise?.requires.includes('barbell') && !perHand) kg = Math.max(BAR_KG, kg);
  if (exercise?.requires.includes('dumbbells') && options.dumbbellMaxKg) {
    kg = Math.min(kg, options.dumbbellMaxKg);
  }
  return {
    kind: 'kg',
    kg: Math.round(kg * 100) / 100,
    oneRmKg: max.oneRmKg,
    basis: max.basis,
    perHand,
    ...(max.fromSlug ? { fromSlug: max.fromSlug } : {}),
  };
}
