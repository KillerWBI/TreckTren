import {
  resolveOneRm,
  type AthleteCard,
  type LiftRecord,
  type StrengthUpdate,
  type WorkingSet,
} from '@trektren/shared';
import { todayIn } from '../../dates.js';
import { pool } from '../../db.js';
import { AppError } from '../../errors.js';
import { applyCardPatch } from '../card/service.js';
import { loadExercises } from '../exercises/repo.js';

type LiftSource = NonNullable<LiftRecord['source']>;

export async function userToday(userId: string): Promise<string> {
  const { rows } = await pool.query<{ timezone: string }>(
    'SELECT timezone FROM profiles WHERE user_id = $1',
    [userId],
  );
  return todayIn(rows[0]?.timezone ?? 'Europe/Warsaw');
}

interface LiftChange {
  testedKg?: number | null | undefined;
  working?: WorkingSet | null | undefined;
  /**
   * Максимум, выставленный тренером по журналу (с ограничением роста +5% за раз).
   * Перекрывает расчёт по рабочему подходу.
   */
  oneRmKg?: number | undefined;
}

/**
 * Новая запись упражнения: меняем только то, что пришло, и пересчитываем максимум.
 * Возвращает null, если данных не осталось — тогда запись удаляется.
 */
export function mergeLift(
  current: LiftRecord | undefined,
  change: LiftChange,
  today: string,
  source: LiftSource,
): LiftRecord | null {
  const next: Partial<LiftRecord> = { ...current };
  if (change.testedKg === null) {
    delete next.testedKg;
    delete next.testedAt;
  } else if (change.testedKg !== undefined && change.testedKg !== current?.testedKg) {
    next.testedKg = change.testedKg;
    next.testedAt = today;
  }
  if (change.working === null) {
    delete next.working;
    delete next.workingAt;
  } else if (change.working && !sameSet(change.working, current?.working)) {
    next.working = change.working;
    next.workingAt = today;
  }

  // Старые записи (только oneRmKg) — как рабочий максимум без подробностей.
  let resolved = resolveOneRm(next) ?? (next.testedKg || next.working ? null : legacy(current));
  if (change.oneRmKg !== undefined) {
    resolved = { oneRmKg: change.oneRmKg, estimated: change.oneRmKg !== next.testedKg };
  }
  if (!resolved) return null;
  const changed =
    current?.oneRmKg !== resolved.oneRmKg ||
    current?.testedKg !== next.testedKg ||
    !sameSet(current?.working, next.working);
  return {
    ...next,
    oneRmKg: resolved.oneRmKg,
    estimated: resolved.estimated,
    updatedAt: changed ? today : (current?.updatedAt ?? today),
    source: changed ? source : (current?.source ?? source),
  } as LiftRecord;
}

function legacy(current: LiftRecord | undefined) {
  if (!current || current.testedKg || current.working) return null;
  return { oneRmKg: current.oneRmKg, estimated: current.estimated };
}

function sameSet(a: WorkingSet | undefined, b: WorkingSet | undefined): boolean {
  if (!a || !b) return a === b;
  return a.weightKg === b.weightKg && a.reps === b.reps && a.rir === b.rir;
}

/** Merge patch для записи: удалённые поля — явным null, иначе они останутся в карточке. */
function liftPatch(current: LiftRecord | undefined, next: LiftRecord | null) {
  if (!next) return null;
  const patch: Record<string, unknown> = { ...next };
  for (const key of Object.keys(current ?? {})) {
    if (!(key in next)) patch[key] = null;
  }
  return patch;
}

export interface StrengthWrite {
  lifts: Array<{ slug: string } & LiftChange>;
  targets?: Record<string, number | null> | undefined;
  /** Откуда цифры — пишется в каждую изменённую запись. */
  source: LiftSource;
  /** Кто правит карточку: человек или код/ИИ. */
  cardSource: 'user' | 'ai';
  reason: string;
}

/** Пишет максимумы, рабочие подходы и цели в «Силовые» одной версией карточки. */
export async function writeStrength(userId: string, card: AthleteCard, write: StrengthWrite) {
  // Только упражнения с весом: у отжиманий и планки максимума в килограммах нет.
  const known = new Set((await loadExercises()).filter((e) => !e.bodyweight).map((e) => e.slug));
  const unknown = [...write.lifts.map((l) => l.slug), ...Object.keys(write.targets ?? {})].filter(
    (slug) => !known.has(slug),
  );
  if (unknown.length > 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Для этих упражнений вес не записывается: ${unknown.join(', ')}`,
    );
  }
  const today = await userToday(userId);
  const lifts: Record<string, unknown> = {};
  for (const { slug, ...change } of write.lifts) {
    const current = card.strength?.lifts?.[slug];
    const merged = mergeLift(current, change, today, write.source);
    if (merged || current) lifts[slug] = liftPatch(current, merged);
  }
  const patch: Record<string, unknown> = {};
  if (Object.keys(lifts).length > 0) patch.lifts = lifts;
  if (write.targets && Object.keys(write.targets).length > 0) patch.targets = write.targets;
  if (Object.keys(patch).length === 0) return null;
  return applyCardPatch(
    userId,
    { strength: patch },
    { source: write.cardSource, reason: write.reason, allowedSections: ['strength'] },
  );
}

/** Правка раздела «Силовые» человеком. */
export function updateStrength(userId: string, update: StrengthUpdate, card: AthleteCard) {
  return writeStrength(userId, card, {
    lifts: update.lifts,
    targets: update.targets,
    source: 'user',
    cardSource: 'user',
    reason: 'Силовые',
  });
}
