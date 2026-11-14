import { z } from 'zod';
import type { MUSCLE_GROUPS } from './athlete-card.js';

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/* Портрет ----------------------------------------------------------------- */

/** Где травма — чтобы отметить на фигуре. */
export type BodyZone =
  'neck' | 'shoulder' | 'elbow' | 'wrist' | 'chest' | 'lowerBack' | 'hip' | 'knee' | 'ankle';

export interface PortraitBody {
  sex: 'male' | 'female';
  heightCm: number;
  weightKg: number;
  bodyFatPct: number;
  /** Процент жира посчитан по ИМТ и возрасту, а не введён. */
  bodyFatEstimated: boolean;
  /** Развитие мышц 0…1 по силовым относительно веса тела; null — данных нет. */
  levels: Record<MuscleGroup, number | null>;
}

/**
 * Состояние мышцы на портрете:
 * good — в норме относительно остального тела; behind — немного отстаёт;
 * weak — сильно отстаёт или отмечена слабым местом; unknown — данных нет.
 */
export type MuscleStatus = 'good' | 'behind' | 'weak' | 'unknown';

/** Базовое движение, по которому оценена мышца. */
export interface MuscleLift {
  slug: string;
  name: string;
  oneRmKg: number | null;
  /** tested — проверенный максимум, working — по рабочему подходу, estimated — расчёт. */
  source: 'tested' | 'working' | 'estimated' | null;
  /** Максимум в долях веса тела. */
  ratio: number | null;
  /** Ступень по нормативам: новичок, средний… */
  tier: string | null;
  /** Следующая ступень: сколько нужно поднять. */
  next: { tier: string; kg: number; ratio: number } | null;
  /** Цель человека из «Силовых». */
  goalKg: number | null;
}

/** Упражнение на эту мышцу из доступных человеку. */
export interface MuscleExercise {
  slug: string;
  name: string;
  /** Мышца — главная в упражнении, а не помощник. */
  primary: boolean;
  /** Стоит в ближайших тренировках плана. */
  inPlan: boolean;
  /** Рабочий вес на 8–10 повторов с запасом 2; null — свой вес или подбор на тренажёре. */
  workKg: number | null;
  perHand: boolean;
  kind: 'kg' | 'bodyweight' | 'calibrate';
}

export interface MuscleDetail {
  group: MuscleGroup;
  level: number | null;
  status: MuscleStatus;
  /** Оценка не своим тестом, а через базовые движения (пресс, икры, предплечья). */
  proxy: boolean;
  levelWord: string;
  priority: boolean;
  /** Слабое место из профиля, если оно про эту мышцу. */
  weak: { area: string; cause: string | null } | null;
  /** Травма рядом с этой мышцей. */
  injury: string | null;
  lifts: MuscleLift[];
  /** Чтобы догнать остальное тело: какое движение и до скольки. */
  catchUp: { slug: string; name: string; kg: number; gapKg: number } | null;
  summary: string;
  exercises: MuscleExercise[];
  /** Главные упражнения на эту мышцу, которые убраны из-за травмы. */
  blockedByInjury: string[];
}

export interface PortraitResponse {
  body: PortraitBody;
  /** Откуда вес: средняя утреннего за 7 дней, последнее взвешивание или карточка. */
  weightSource: 'average' | 'log' | 'card' | 'default';
  bmi: number;
  age: number | null;
  /** Средний уровень силы словами: новичок … сильный. */
  strengthLabel: string | null;
  priority: MuscleGroup[];
  weak: MuscleGroup[];
  injuries: Array<{ zone: BodyZone; area: string }>;
  /** Разделы карточки: сколько заполнено — так растёт человечек. */
  completeness: { filled: number; total: number };
  /** Каким был в начале пути — для сравнения «было / стало». */
  start: { date: string; body: PortraitBody } | null;
  /** Подробно по каждой мышце: статус, движения, цели и упражнения. */
  muscles: MuscleDetail[];
  /** Средний уровень мышц — с ним сравнивается каждая. */
  medianLevel: number | null;
}

/* Сон и самочувствие ----------------------------------------------------- */

export const SLEEP_TEXT: Record<number, string> = {
  1: 'Почти не спал, просыпался',
  2: 'Плохо, тяжело встал',
  3: 'Нормально',
  4: 'Хорошо выспался',
  5: 'Отлично, проснулся сам',
};

export const WELLBEING_TEXT: Record<number, string> = {
  1: 'Разбит, болит, сил нет',
  2: 'Усталость, вялость',
  3: 'Обычно',
  4: 'Бодро',
  5: 'Полон сил',
};

export const wellbeingInputSchema = z.strictObject({
  sleepHours: z.number().min(0).max(24).nullable().optional(),
  sleepScore: z.number().int().min(1).max(5).nullable().optional(),
  wellbeingScore: z.number().int().min(1).max(5).nullable().optional(),
});
export type WellbeingInput = z.infer<typeof wellbeingInputSchema>;

export interface WellbeingView {
  sleepHours: number | null;
  sleepScore: number | null;
  wellbeingScore: number | null;
}

/* Прогресс --------------------------------------------------------------- */

export interface ProgressDay {
  date: string;
  morning: number | null;
  evening: number | null;
  avg7: number | null;
  steps: number | null;
  kcal: number | null;
  proteinG: number | null;
  sleepHours: number | null;
  wellbeing: number | null;
}

export interface StrengthSeries {
  slug: string;
  name: string;
  /** Лучший расчётный максимум за день тренировки или проходки. */
  points: Array<{ date: string; e1rm: number }>;
  currentKg: number | null;
  goalKg: number | null;
}

export interface RecordView {
  slug: string;
  name: string;
  date: string;
  weightKg: number;
  reps: number;
  e1rm: number;
}

export interface ProgressResponse {
  from: string;
  to: string;
  days: ProgressDay[];
  strength: StrengthSeries[];
  records: RecordView[];
  workouts: { planned: number; done: number; missed: number };
}

/* Недельный разбор ------------------------------------------------------- */

export interface WeeklyStats {
  weightChangeKg: number | null;
  weightChangePct: number | null;
  avgSteps: number | null;
  stepsDays: number;
  /** Средние за дни, где еда записана. */
  avgKcal: number | null;
  avgNormKcal: number | null;
  avgProteinG: number | null;
  proteinNormG: number | null;
  foodDays: number;
  sessionsPlanned: number;
  sessionsDone: number;
  sessionsMissed: number;
  avgSleepHours: number | null;
  avgWellbeing: number | null;
  /** Максимумы, изменившиеся за неделю. */
  strength: Array<{ name: string; fromKg: number; toKg: number }>;
}

export interface WeeklyReview {
  id: string;
  weekStart: string;
  weekEnd: string;
  stats: WeeklyStats;
  /** Поправка нормы, ккал (не больше ±300); 0 — не менять. */
  kcalDelta: number;
  /** Объём тренировок в следующем блоке. */
  volume: 'up' | 'keep' | 'down';
  volumeText: string;
  /** Что хорошо, что плохо — короткими пунктами. */
  points: string[];
  text: string;
  source: 'ai' | 'rules';
  createdAt: string;
}
