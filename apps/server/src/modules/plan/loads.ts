import { weightForReps, type LoadView, type PlannedExercise } from '@trektren/shared';
import type { Exercise } from '../exercises/repo.js';

/**
 * Вес на подход по актуальному 1ПМ: середина диапазона повторов плюс запас,
 * обратная формула Эпли, округление вниз до шага снаряда.
 * Нет 1ПМ — человек подбирает вес на тренировке по запасу.
 */
export function loadFor(
  planned: PlannedExercise,
  exercise: Exercise | undefined,
  oneRmKg: number | undefined,
): LoadView {
  if (exercise?.bodyweight) return { kind: 'bodyweight' };
  if (!oneRmKg) return { kind: 'calibrate' };
  const reps = Math.ceil((planned.repsMin + planned.repsMax) / 2);
  const raw = weightForReps(oneRmKg, reps, planned.rir) * planned.loadFactor;
  const step = exercise?.weightStepKg ?? 2.5;
  const kg = Math.max(step, Math.floor(raw / step) * step);
  return { kind: 'kg', kg: Math.round(kg * 100) / 100, oneRmKg };
}
