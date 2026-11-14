import { z } from 'zod';
import type { SessionView } from './plan.js';
import type { WellbeingView } from './progress.js';

const isoDate = z.iso.date();
const slug = z.string().regex(/^[a-z0-9-]{2,64}$/);

/* Тренировка ------------------------------------------------------------- */

/** Самочувствие перед тренировкой 1–5. */
export const READINESS_TEXT: Record<number, string> = {
  1: 'Разбит: болит, не выспался, сил нет',
  2: 'Тяжело: усталость, плохой сон',
  3: 'Обычно',
  4: 'Хорошо: выспался, есть силы',
  5: 'Отлично: готов к рекордам',
};

export const startWorkoutSchema = z.strictObject({
  sessionId: z.uuid().optional(),
  readiness: z.number().int().min(1).max(5).optional(),
});
export type StartWorkout = z.infer<typeof startWorkoutSchema>;

export const workoutSetSchema = z.strictObject({
  exerciseSlug: slug,
  setNo: z.number().int().min(1).max(20),
  weightKg: z.number().min(0).max(600),
  reps: z.number().int().min(0).max(100),
  rir: z.number().int().min(0).max(10),
});
export type WorkoutSetInput = z.infer<typeof workoutSetSchema>;

export const finishWorkoutSchema = z.strictObject({
  notes: z.string().trim().max(1000).optional(),
});

export interface WorkoutSetView extends WorkoutSetInput {
  /** Расчётный максимум по подходу: вес × (1 + (повторы + запас) / 30). */
  est1rm: number;
}

/**
 * progress — сильнее, чем считал план; hold — по плану; heavy — тяжелее, чем ждали;
 * under — второй раз подряд не дотянул, веса снижены; first — первая запись, вес теперь известен;
 * skipped — упражнение не сделано.
 */
export type ExerciseVerdict = 'progress' | 'hold' | 'heavy' | 'under' | 'first' | 'skipped';

export interface ExerciseAnalysis {
  slug: string;
  name: string;
  verdict: ExerciseVerdict;
  text: string;
  plannedSets: number;
  doneSets: number;
  /** Лучший расчётный максимум за тренировку. */
  bestE1rm: number | null;
  /** Максимум, от которого считаются веса: было → стало. */
  maxBefore: number | null;
  maxAfter: number | null;
  record: boolean;
}

export interface WorkoutAnalysis {
  exercises: ExerciseAnalysis[];
  summary: string;
  /** Короткий разбор от ИИ, если он подключён. */
  coachNote: string | null;
  /** Что тренер поменял в следующих тренировках. */
  nextChanges: string[];
}

export interface WorkoutView {
  id: string;
  sessionId: string | null;
  date: string;
  readiness: number | null;
  startedAt: string;
  finishedAt: string | null;
  notes: string | null;
  sets: WorkoutSetView[];
  analysis: WorkoutAnalysis | null;
}

export interface WorkoutResponse {
  workout: WorkoutView;
  /** Тренировка из плана с весами на сегодня; null — свободная тренировка. */
  session: SessionView | null;
}

/* День: вес, шаги, еда --------------------------------------------------- */

export const TIMES_OF_DAY = ['morning', 'evening'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const weightInputSchema = z.strictObject({
  date: isoDate,
  timeOfDay: z.enum(TIMES_OF_DAY),
  weightKg: z.number().min(30).max(300),
});

export const stepsInputSchema = z.strictObject({
  steps: z.number().int().min(0).max(150_000),
});

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const mealItemSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  grams: z.number().min(0).max(5000),
  kcal: z.number().min(0).max(10000),
  proteinG: z.number().min(0).max(1000),
  fatG: z.number().min(0).max(1000),
  carbsG: z.number().min(0).max(1000),
});
export type MealItem = z.infer<typeof mealItemSchema>;

export const mealInputSchema = z.strictObject({
  date: isoDate,
  mealType: z.enum(MEAL_TYPES),
  inputType: z.enum(['manual', 'text']),
  title: z.string().trim().min(1).max(200),
  items: z.array(mealItemSchema).min(1).max(30),
});
export type MealInput = z.infer<typeof mealInputSchema>;

export const mealParseSchema = z.strictObject({
  text: z.string().trim().min(2).max(500),
});

/** Ответ ИИ на разбор еды — проверяется поштучно. */
export const parsedFoodSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        grams: z.number().min(0).max(5000),
        kcal: z.number().min(0).max(10000),
        proteinG: z.number().min(0).max(1000),
        fatG: z.number().min(0).max(1000),
        carbsG: z.number().min(0).max(1000),
      }),
    )
    .min(1)
    .max(30),
  note: z.string().max(300).optional(),
});
export type ParsedFood = z.infer<typeof parsedFoodSchema>;

export const calorieAdjustSchema = z.strictObject({
  kcal: z.number().int().min(-1000).max(1000),
});

export interface Macros {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export interface DayNorm extends Macros {
  /** Из чего сложилась норма — показывается человеку. */
  parts: {
    bmr: number;
    base: number;
    steps: number;
    training: number;
    goal: number;
    adjust: number;
  };
  /** logged — шаги вписаны, average — средние из карточки, none — нет данных. */
  stepsSource: 'logged' | 'average' | 'none';
  trainingDay: boolean;
  weightKg: number;
  /** Норма упёрлась в нижнюю границу 1800 ккал. */
  floorApplied: boolean;
}

export interface MealView {
  id: string;
  mealType: MealType;
  inputType: 'manual' | 'text' | 'photo';
  title: string;
  items: MealItem[];
  totals: Macros;
  createdAt: string;
}

export interface WeightPoint {
  date: string;
  morning: number | null;
  evening: number | null;
  /** Средняя утреннего веса за 7 дней, если в окне хотя бы 3 взвешивания. */
  avg7: number | null;
}

export interface WeightTrend {
  avg7: number | null;
  weeklyChangeKg: number | null;
  weeklyChangePct: number | null;
  /** Нужный темп под цель, % веса в неделю. */
  targetPct: [number, number];
  verdict: 'on_track' | 'too_slow' | 'too_fast' | 'not_enough_data';
  text: string;
  /** Рекомендованная поправка нормы, ккал в день; 0 — менять нечего. */
  kcalSuggestion: number;
  /** Средняя разница вечер − утро. */
  eveningDelta: number | null;
  points: WeightPoint[];
}

export interface FoodSuggestion {
  name: string;
  grams: number;
  proteinG: number;
  kcal: number;
}

export interface DayResponse {
  date: string;
  /** null — для нормы не хватает данных карточки. */
  norm: DayNorm | null;
  normMissing: string[];
  eaten: Macros;
  meals: MealView[];
  weights: { morning: number | null; evening: number | null };
  steps: number | null;
  trend: WeightTrend;
  /** Тренировка из плана на этот день. */
  session: { id: string; title: string; status: SessionView['status'] } | null;
  workout: { id: string; finished: boolean } | null;
  /** Чем добрать белок до нормы. */
  suggestions: FoodSuggestion[];
  /** Частые приёмы пищи — повторить одним нажатием. */
  recentMeals: Array<{ title: string; items: MealItem[]; totals: Macros; times: number }>;
  calorieAdjust: number;
  wellbeing: WellbeingView;
}
