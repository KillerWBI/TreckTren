import type { ExerciseView } from '@trektren/shared';
import { pool } from '../../db.js';

export interface Exercise extends ExerciseView {
  id: number;
  minRir: number;
  contraindications: string[];
}

interface ExerciseRow {
  id: number;
  slug: string;
  name_ru: string;
  pattern: string;
  primary_muscles: string[];
  secondary_muscles: string[];
  requires: string[];
  tier: 'S' | 'A' | 'B';
  is_compound: boolean;
  baseline: boolean;
  bodyweight: boolean;
  weight_step_kg: number | null;
  min_rir: number;
  contraindications: string[];
  ref_slug: string | null;
  ref_ratio: number | null;
  per_hand: boolean;
  stack: boolean;
}

let cache: Promise<Exercise[]> | null = null;

/** Общая база упражнений. Меняется только миграциями, поэтому живёт в памяти процесса. */
export function loadExercises(): Promise<Exercise[]> {
  cache ??= pool
    .query<ExerciseRow>(
      `SELECT id, slug, name_ru, pattern, primary_muscles, secondary_muscles, requires, tier,
              is_compound, baseline, bodyweight, weight_step_kg, min_rir, contraindications,
              ref_slug, ref_ratio, per_hand, stack
       FROM exercises WHERE user_id IS NULL ORDER BY pattern, tier, id`,
    )
    .then((r) => r.rows.map(toExercise))
    .catch((err: unknown) => {
      cache = null;
      throw err;
    });
  return cache;
}

export function toView(e: Exercise): ExerciseView {
  return {
    slug: e.slug,
    name: e.name,
    pattern: e.pattern,
    primaryMuscles: e.primaryMuscles,
    secondaryMuscles: e.secondaryMuscles,
    requires: e.requires,
    tier: e.tier,
    isCompound: e.isCompound,
    baseline: e.baseline,
    bodyweight: e.bodyweight,
    weightStepKg: e.weightStepKg,
    refSlug: e.refSlug,
    refRatio: e.refRatio,
    perHand: e.perHand,
    stack: e.stack,
  };
}

function toExercise(r: ExerciseRow): Exercise {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name_ru,
    pattern: r.pattern,
    primaryMuscles: r.primary_muscles,
    secondaryMuscles: r.secondary_muscles,
    requires: r.requires,
    tier: r.tier,
    isCompound: r.is_compound,
    baseline: r.baseline,
    bodyweight: r.bodyweight,
    weightStepKg: r.weight_step_kg,
    refSlug: r.ref_slug,
    refRatio: r.ref_ratio,
    perHand: r.per_hand,
    stack: r.stack,
    minRir: r.min_rir,
    contraindications: r.contraindications,
  };
}
