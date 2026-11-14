import type { PoolClient } from 'pg';
import {
  applyMergePatch,
  athleteCardSchema,
  topLevelPatch,
  type AthleteCard,
  type CardResponse,
  type CardSection,
  type CardSource,
  type CardVersionDetail,
  type CardVersionSummary,
} from '@trektren/shared';
import { pool, withTransaction } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { formatIssues } from '../../validate.js';

interface ProfileRow {
  athlete_card: Record<string, unknown>;
  card_version: number;
  updated_at: Date;
}

interface VersionRow {
  version: number;
  source: CardSource;
  reason: string | null;
  patch: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  created_at: Date;
}

export interface ApplyPatchOptions {
  source: CardSource;
  reason?: string | undefined;
  /** Версия, от которой правили; если карточка уже ушла вперёд — 409. */
  baseVersion?: number | undefined;
  /** Разделы, которые этому источнику можно менять. */
  allowedSections: readonly CardSection[];
}

export interface ApplyPatchResult extends CardResponse {
  changed: boolean;
}

export async function getCard(userId: string): Promise<CardResponse> {
  const { rows } = await pool.query<ProfileRow>(
    'SELECT athlete_card, card_version, updated_at FROM profiles WHERE user_id = $1',
    [userId],
  );
  const row = rows[0];
  if (!row) throw notFound('Профиль не найден');
  return toCardResponse(row);
}

export async function applyCardPatch(
  userId: string,
  patch: Record<string, unknown>,
  options: ApplyPatchOptions,
): Promise<ApplyPatchResult> {
  const forbidden = Object.keys(patch).filter(
    (key) => !(options.allowedSections as readonly string[]).includes(key),
  );
  if (forbidden.length > 0) {
    throw new AppError(403, 'CARD_SECTION_FORBIDDEN', 'Эти разделы профиля меняет не человек', {
      sections: forbidden,
    });
  }

  return withTransaction(async (c) => {
    const current = await lockProfile(c, userId);
    if (options.baseVersion !== undefined && options.baseVersion !== current.card_version) {
      throw new AppError(409, 'VERSION_CONFLICT', 'Профиль изменился, обнови страницу', {
        currentVersion: current.card_version,
      });
    }

    let merged: unknown;
    try {
      merged = applyMergePatch(current.athlete_card, patch);
    } catch (err) {
      throw new AppError(400, 'VALIDATION_ERROR', (err as Error).message);
    }
    const next = validateCard(merged);
    return saveVersion(c, userId, current, next, options.source, options.reason);
  });
}

export async function listVersions(userId: string, limit = 50): Promise<CardVersionSummary[]> {
  const { rows } = await pool.query<VersionRow>(
    `SELECT version, source, reason, patch, snapshot, created_at
     FROM card_versions WHERE user_id = $1 ORDER BY version DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toSummary);
}

export async function getVersion(userId: string, version: number): Promise<CardVersionDetail> {
  const { rows } = await pool.query<VersionRow>(
    `SELECT version, source, reason, patch, snapshot, created_at
     FROM card_versions WHERE user_id = $1 AND version = $2`,
    [userId, version],
  );
  const row = rows[0];
  if (!row) throw notFound('Версия не найдена');
  return { ...toSummary(row), snapshot: row.snapshot as AthleteCard };
}

/** Откат: снимок старой версии становится новой версией, история не переписывается. */
export async function restoreVersion(userId: string, version: number): Promise<ApplyPatchResult> {
  return withTransaction(async (c) => {
    const { rows } = await c.query<Pick<VersionRow, 'snapshot'>>(
      'SELECT snapshot FROM card_versions WHERE user_id = $1 AND version = $2',
      [userId, version],
    );
    const target = rows[0];
    if (!target) throw notFound('Версия не найдена');
    const current = await lockProfile(c, userId);
    const next = validateCard(target.snapshot);
    return saveVersion(c, userId, current, next, 'user', `Откат к версии ${version}`);
  });
}

async function lockProfile(c: PoolClient, userId: string): Promise<ProfileRow> {
  const { rows } = await c.query<ProfileRow>(
    'SELECT athlete_card, card_version, updated_at FROM profiles WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  if (!rows[0]) throw notFound('Профиль не найден');
  return rows[0];
}

function validateCard(value: unknown): AthleteCard {
  const result = athleteCardSchema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      422,
      'CARD_INVALID',
      'Профиль не прошёл проверку',
      formatIssues(result.error),
    );
  }
  return result.data;
}

async function saveVersion(
  c: PoolClient,
  userId: string,
  current: ProfileRow,
  next: AthleteCard,
  source: CardSource,
  reason: string | undefined,
): Promise<ApplyPatchResult> {
  const diff = topLevelPatch(current.athlete_card, next as Record<string, unknown>);
  if (Object.keys(diff).length === 0) {
    return { ...toCardResponse(current), changed: false };
  }

  const version = current.card_version + 1;
  const { rows } = await c.query<ProfileRow>(
    `UPDATE profiles SET athlete_card = $2, card_version = $3, updated_at = now()
     WHERE user_id = $1 RETURNING athlete_card, card_version, updated_at`,
    [userId, JSON.stringify(next), version],
  );
  await c.query(
    `INSERT INTO card_versions (user_id, version, patch, snapshot, source, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, version, JSON.stringify(diff), JSON.stringify(next), source, reason ?? null],
  );
  return { ...toCardResponse(rows[0]!), changed: true };
}

function toCardResponse(row: ProfileRow): CardResponse {
  return {
    card: row.athlete_card as AthleteCard,
    version: row.card_version,
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSummary(row: VersionRow): CardVersionSummary {
  return {
    version: row.version,
    source: row.source,
    reason: row.reason,
    changedSections: Object.keys(row.patch).sort(),
    createdAt: row.created_at.toISOString(),
  };
}
