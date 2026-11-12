import { z } from 'zod';
import { workingSetSchema } from './athlete-card.js';
import type { WorkingSet } from './athlete-card.js';

const isoDate = z.iso.date();
export const exerciseSlugSchema = z.string().regex(/^[a-z0-9-]{2,64}$/);

/**
 * Шаблон блока: какие тренировки чередуются, что в них и как растёт нагрузка по неделям.
 * Его строит ИИ (или правила, если ИИ не подключён), а по датам раскладывает код.
 * Схема нестрогая: лишние поля от модели отбрасываются, остальное проверяет normalizeTemplate.
 */
export const templateExerciseSchema = z.object({
  slug: z.string().min(1).max(64),
  sets: z.number().int().min(1).max(6),
  repsMin: z.number().int().min(1).max(60),
  repsMax: z.number().int().min(1).max(60),
  note: z.string().max(200).optional(),
});

export const sessionTemplateSchema = z.object({
  key: z.string().regex(/^[A-Z][1-9]?$/),
  title: z.string().min(1).max(80),
  exercises: z.array(templateExerciseSchema).min(2).max(10),
});

export const weekRuleSchema = z.object({
  rir: z.number().int().min(0).max(4),
  extraSets: z.number().int().min(0).max(2),
});

/**
 * Цифры, которые человек написал текстом (заметки, слабые места, комментарий к плану),
 * а не в разделе «Силовые». ИИ их находит, код записывает в карточку.
 */
export const textLiftSchema = z.object({
  slug: z.string().min(1).max(64),
  kind: z.enum(['max', 'working']),
  weightKg: z.number().min(1).max(600),
  reps: z.number().int().min(1).max(20).optional(),
  rir: z.number().int().min(0).max(5).optional(),
});
export const textTargetSchema = z.object({
  slug: z.string().min(1).max(64),
  weightKg: z.number().min(1).max(600),
});
export const textFactsSchema = z.object({
  lifts: z.array(textLiftSchema).max(20).optional(),
  targets: z.array(textTargetSchema).max(10).optional(),
});
export type TextFacts = z.infer<typeof textFactsSchema>;

export const blockTemplateSchema = z.object({
  split: z.string().min(1).max(80),
  accumulationWeeks: z.number().int().min(3).max(5),
  weeks: z.array(weekRuleSchema).min(3).max(5),
  sessions: z.array(sessionTemplateSchema).min(1).max(6),
  rotation: z.array(z.string()).min(1).max(12),
  rationale: z.string().min(1).max(1500),
  coachNote: z.string().min(1).max(500),
  fromText: textFactsSchema.optional(),
});

export type TemplateExercise = z.infer<typeof templateExerciseSchema>;
export type SessionTemplate = z.infer<typeof sessionTemplateSchema>;
export type BlockTemplate = z.infer<typeof blockTemplateSchema>;

export const PLAN_SOURCES = ['ai', 'rules'] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];
export type SessionPhase = 'accumulation' | 'deload' | 'test' | 'after_block';

/** Предписание на конкретную дату: подходы, повторы, запас. Килограммы считаются при чтении по актуальным максимумам. */
export interface PlannedExercise {
  slug: string;
  sets: number;
  repsMin: number;
  repsMax: number;
  rir: number;
  /** Множитель к расчётному весу: 0,9 на разгрузке и после долгого перерыва. */
  loadFactor: number;
  /** Вес попытки на проходке: ставится как есть, без расчёта. */
  targetKg?: number;
  note?: string;
}

export interface PlannedSession {
  week: number;
  phase: SessionPhase;
  templateKey: string;
  title: string;
  /** Дней с прошлой тренировки блока; null — первая. */
  gapDays: number | null;
  /** Что тренер поменял из-за интервалов и перерывов — показывается человеку. */
  adjustments: string[];
  exercises: PlannedExercise[];
}

/**
 * Откуда вес: own — от максимума этого упражнения, ratio — от максимума опорного движения
 * через соотношение, bodyweight — по весу тела и стажу (данных нет вообще), target — вес проходки.
 */
export type LoadBasis = 'own' | 'ratio' | 'bodyweight' | 'target';

export type LoadView =
  | {
      kind: 'kg';
      kg: number;
      oneRmKg: number;
      basis: LoadBasis;
      /** Вес одной гантели. */
      perHand: boolean;
      /** Опорное движение, от которого посчитан вес. */
      fromSlug?: string;
    }
  /** stack — блок или тренажёр, no_data — не от чего считать. */
  | { kind: 'calibrate'; reason: 'stack' | 'no_data' }
  | { kind: 'bodyweight' };

export interface SessionExerciseView extends PlannedExercise {
  name: string;
  load: LoadView;
}

export interface SessionView extends Omit<PlannedSession, 'exercises'> {
  id: string;
  date: string;
  status: 'planned' | 'done' | 'missed' | 'moved';
  exercises: SessionExerciseView[];
}

export interface BlockView {
  id: string;
  startDate: string;
  accumulationWeeks: number;
  split: string;
  rationale: string;
  coachNote: string;
  source: PlanSource;
  model: string | null;
  comment: string | null;
  /** Почему план собран не так, как ожидалось: например, ИИ не ответил. */
  generationNote: string | null;
  /** Упражнения, убранные из-за травм, запретов и оборудования. */
  excluded: string[];
  /** Что ИИ взял из текста анкеты и комментария и записал в «Силовые». */
  factsNote: string | null;
  /** Разделы карточки, изменённые после построения плана: план стоит перестроить. */
  staleSections: string[];
  createdAt: string;
}

export interface PlanResponse {
  block: BlockView | null;
  sessions: SessionView[];
  ai: { enabled: boolean; model: string | null };
}

const datesSchema = z
  .array(isoDate)
  .min(1, { error: 'Отметь хотя бы один день' })
  .max(48, { error: 'Не больше 48 тренировок за раз' });

export const generatePlanRequestSchema = z.strictObject({
  dates: datesSchema,
  comment: z.string().trim().max(1000).optional(),
});
export type GeneratePlanRequest = z.infer<typeof generatePlanRequestSchema>;

export const scheduleRequestSchema = z.strictObject({ dates: datesSchema });

/**
 * Правка раздела «Силовые». По каждому упражнению — максимум на 1 раз и/или рабочий подход.
 * null удаляет значение, отсутствие поля — не трогает.
 */
export const strengthUpdateSchema = z.strictObject({
  lifts: z
    .array(
      z.strictObject({
        slug: exerciseSlugSchema,
        testedKg: z.number().min(1).max(600).nullable().optional(),
        working: workingSetSchema.nullable().optional(),
      }),
    )
    .max(40)
    .default([]),
  targets: z.record(exerciseSlugSchema, z.number().min(1).max(600).nullable()).optional(),
});
export type StrengthUpdate = z.infer<typeof strengthUpdateSchema>;

/**
 * Какой максимум брать: реально сделанный на 1 раз. Расчёт по рабочему подходу —
 * если максимума нет или подход свежее и показывает больше (человек стал сильнее).
 */
export function resolveOneRm(record: {
  testedKg?: number | undefined;
  testedAt?: string | undefined;
  working?: WorkingSet | undefined;
  workingAt?: string | undefined;
}): { oneRmKg: number; estimated: boolean } | null {
  const fromWorking = record.working
    ? round1(epleyOneRm(record.working.weightKg, record.working.reps + record.working.rir))
    : null;
  if (record.testedKg) {
    const newer = record.workingAt && record.testedAt ? record.workingAt > record.testedAt : false;
    if (fromWorking && newer && fromWorking > record.testedKg) {
      return { oneRmKg: fromWorking, estimated: true };
    }
    return { oneRmKg: record.testedKg, estimated: false };
  }
  return fromWorking ? { oneRmKg: fromWorking, estimated: true } : null;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export interface ExerciseView {
  slug: string;
  name: string;
  pattern: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  requires: string[];
  tier: 'S' | 'A' | 'B';
  isCompound: boolean;
  baseline: boolean;
  bodyweight: boolean;
  weightStepKg: number | null;
  /** Опорное движение и соотношение максимумов: вес ≈ refRatio × максимум refSlug. */
  refSlug: string | null;
  refRatio: number | null;
  perHand: boolean;
  /** Блок или тренажёр: вес подбирается на месте. */
  stack: boolean;
}

/** Расчётный 1ПМ по Эпли. */
export function epleyOneRm(weightKg: number, reps: number): number {
  return reps <= 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** Вес на подход: повторы с запасом rir при известном 1ПМ — обратная формула Эпли. */
export function weightForReps(oneRmKg: number, reps: number, rir: number): number {
  return oneRmKg / (1 + (reps + rir) / 30);
}
