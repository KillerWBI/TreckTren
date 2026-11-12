import { z } from 'zod';

/**
 * Карточка атлета — единственный источник правды о человеке.
 * Все разделы необязательны: карточка заполняется постепенно (онбординг, правки, логи, ИИ).
 * Объекты строгие: неизвестный ключ — ошибка, чтобы опечатка в патче не сохранилась молча.
 */

const isoDate = z.iso.date();
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(2000);

export const SEXES = ['male', 'female'] as const;

export const PRIMARY_GOALS = [
  'strength',
  'hypertrophy',
  'strength_hypertrophy',
  'fat_loss',
  'recomp',
  'general_fitness',
] as const;

export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'traps',
  'abs',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
] as const;

export const EQUIPMENT_ITEMS = [
  'barbell',
  'rack',
  'bench',
  'dumbbells',
  'cable',
  'machines',
  'leg_press',
  'smith',
  'pullup_bar',
  'dip_bars',
  'kettlebells',
  'bands',
] as const;

export const LEVELS = ['low', 'medium', 'high'] as const;
export const JOB_TYPES = ['sedentary', 'mixed', 'on_feet'] as const;
export const TRAINING_LOCATIONS = ['gym', 'home'] as const;
export const WEAK_POINT_STATUSES = ['suspected', 'testing', 'confirmed', 'resolved'] as const;

/** ISO-день недели: 1 = понедельник … 7 = воскресенье. */
const weekday = z.number().int().min(1).max(7);
const exerciseSlug = z.string().regex(/^[a-z0-9_-]{1,64}$/);

export const basicsSchema = z.strictObject({
  sex: z.enum(SEXES).optional(),
  birthDate: isoDate.optional(),
  heightCm: z.number().min(120).max(230).optional(),
  weightKg: z.number().min(30).max(300).optional(),
  bodyFatPct: z.number().min(3).max(60).optional(),
});

export const experienceSchema = z.strictObject({
  trainingYears: z.number().min(0).max(60).optional(),
  breaks: longText.optional(),
  pastPrograms: longText.optional(),
  techniqueConfidence: z.enum(LEVELS).optional(),
});

export const goalTargetSchema = z.strictObject({
  metric: shortText,
  value: z.number(),
  unit: z.string().trim().min(1).max(16),
});

export const goalsSchema = z.strictObject({
  primary: z.enum(PRIMARY_GOALS).optional(),
  secondary: z.array(z.enum(PRIMARY_GOALS)).max(3).optional(),
  priorityMuscles: z.array(z.enum(MUSCLE_GROUPS)).max(MUSCLE_GROUPS.length).optional(),
  priorityLifts: z.array(shortText).max(10).optional(),
  targets: z.array(goalTargetSchema).max(20).optional(),
  deadline: isoDate.optional(),
  notes: longText.optional(),
});

export const availabilitySchema = z.strictObject({
  sessionsPerWeek: z.number().int().min(1).max(7).optional(),
  sessionMinutes: z.number().int().min(20).max(180).optional(),
  usualDays: z.array(weekday).max(7).optional(),
});

export const equipmentSchema = z.strictObject({
  location: z.enum(TRAINING_LOCATIONS).optional(),
  items: z.array(z.enum(EQUIPMENT_ITEMS)).max(EQUIPMENT_ITEMS.length).optional(),
  dumbbellMaxKg: z.number().min(1).max(100).optional(),
  notes: longText.optional(),
});

export const injurySchema = z.strictObject({
  area: shortText,
  description: longText,
  since: isoDate.optional(),
});

export const limitationsSchema = z.strictObject({
  injuries: z.array(injurySchema).max(20).optional(),
  bannedMovements: z.array(shortText).max(30).optional(),
});

export const activitySchema = z.strictObject({
  jobType: z.enum(JOB_TYPES).optional(),
  avgSteps: z.number().int().min(0).max(100_000).optional(),
  otherSports: longText.optional(),
});

export const nutritionSchema = z.strictObject({
  mealsPerDay: z.number().int().min(1).max(8).optional(),
  excludedFoods: z.array(shortText).max(50).optional(),
  cooksSelf: z.boolean().optional(),
  budget: z.enum(LEVELS).optional(),
});

export const recoverySchema = z.strictObject({
  typicalSleepHours: z.number().min(0).max(14).optional(),
  avgSleepScore: z.number().min(1).max(5).optional(),
  avgWellbeingScore: z.number().min(1).max(5).optional(),
  stress: z.enum(LEVELS).optional(),
});

export const liftRecordSchema = z.strictObject({
  oneRmKg: z.number().min(0).max(600),
  estimated: z.boolean(),
  updatedAt: isoDate,
});

export const strengthSchema = z.strictObject({
  lifts: z.record(exerciseSlug, liftRecordSchema).optional(),
});

export const weakPointSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  area: shortText,
  cause: longText.optional(),
  status: z.enum(WEAK_POINT_STATUSES),
  source: z.enum(['ai', 'user']),
  updatedAt: isoDate,
});

export const forecastSchema = z.strictObject({
  ffmi: z.number().min(5).max(40).optional(),
  ffmiNormalized: z.number().min(5).max(40).optional(),
  ffmiLimit: z.number().min(5).max(40).optional(),
  summary: longText.optional(),
  updatedAt: isoDate.optional(),
});

export const coachNoteSchema = z.strictObject({
  date: isoDate,
  text: longText,
});

export const athleteCardSchema = z.strictObject({
  basics: basicsSchema.optional(),
  experience: experienceSchema.optional(),
  goals: goalsSchema.optional(),
  availability: availabilitySchema.optional(),
  equipment: equipmentSchema.optional(),
  limitations: limitationsSchema.optional(),
  activity: activitySchema.optional(),
  nutrition: nutritionSchema.optional(),
  recovery: recoverySchema.optional(),
  strength: strengthSchema.optional(),
  weakPoints: z.array(weakPointSchema).max(20).optional(),
  forecast: forecastSchema.optional(),
  coachNotes: z.array(coachNoteSchema).max(50).optional(),
});

export type AthleteCard = z.infer<typeof athleteCardSchema>;
export type CardSection = keyof AthleteCard;

export const CARD_SECTIONS = Object.keys(athleteCardSchema.shape) as CardSection[];

/** Разделы, которые человек правит сам. Силовые, прогноз и заметки тренера ведут код и ИИ. */
export const USER_EDITABLE_SECTIONS = [
  'basics',
  'experience',
  'goals',
  'availability',
  'equipment',
  'limitations',
  'activity',
  'nutrition',
  'recovery',
  'weakPoints',
] as const satisfies readonly CardSection[];

/**
 * Без этих разделов план не строится. Оборудование и ограничения необязательны:
 * без списка снарядов считаем, что зал полный, а без травм — что ограничений нет.
 */
export const REQUIRED_CARD_SECTIONS = [
  'goals',
  'basics',
  'availability',
] as const satisfies readonly CardSection[];

/** Раздел заполнен: непустой объект или непустой список. */
export function isSectionFilled(card: AthleteCard, key: CardSection): boolean {
  const value = card[key];
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}

export const CARD_SOURCES = ['onboarding', 'user', 'ai'] as const;
export type CardSource = (typeof CARD_SOURCES)[number];

/** Тело PATCH /card: merge patch по разделам + версия, от которой человек правил. */
export const cardPatchRequestSchema = z.strictObject({
  patch: z.record(z.string(), z.unknown()),
  baseVersion: z.number().int().min(0).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type CardPatchRequest = z.infer<typeof cardPatchRequestSchema>;

export interface CardResponse {
  card: AthleteCard;
  version: number;
  updatedAt: string;
}

export interface CardVersionSummary {
  version: number;
  source: CardSource;
  reason: string | null;
  changedSections: string[];
  createdAt: string;
}

export interface CardVersionDetail extends CardVersionSummary {
  snapshot: AthleteCard;
}
