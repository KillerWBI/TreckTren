import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import type { PublicUser } from '@trektren/shared';
import { config } from '../../config.js';
import { pool, withTransaction, type Db } from '../../db.js';
import { AppError } from '../../errors.js';
import { generateRefreshToken, hashRefreshToken, refreshExpiresAt } from './tokens.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

/** Окно, в котором повторное использование старого refresh-токена не считается кражей (две вкладки). */
const REUSE_GRACE_MS = 10_000;

const toPublicUser = (row: Pick<UserRow, 'id' | 'email' | 'created_at'>): PublicUser => ({
  id: row.id,
  email: row.email,
  createdAt: row.created_at.toISOString(),
});

let dummyHash: Promise<string> | undefined;
/** Сравнение с фиктивным хэшем, чтобы время ответа не выдавало, есть ли такой email. */
const getDummyHash = () => (dummyHash ??= bcrypt.hash('dummy-password', config.BCRYPT_ROUNDS));

export interface Session {
  user: PublicUser;
  refreshToken: string;
}

export async function register(email: string, password: string): Promise<Session> {
  const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
  try {
    return await withTransaction(async (c) => {
      const { rows } = await c.query<UserRow>(
        `INSERT INTO users (email, password_hash, health_consent_at, adult_confirmed_at)
         VALUES ($1, $2, now(), now())
         RETURNING id, email, password_hash, created_at`,
        [email, passwordHash],
      );
      const user = rows[0]!;
      await c.query('INSERT INTO profiles (user_id) VALUES ($1)', [user.id]);
      await c.query('INSERT INTO onboarding (user_id) VALUES ($1)', [user.id]);
      const refreshToken = await issueRefreshToken(c, user.id);
      return { user: toPublicUser(user), refreshToken };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError(409, 'EMAIL_TAKEN', 'Этот email уже зарегистрирован');
    }
    throw err;
  }
}

export async function login(email: string, password: string): Promise<Session> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, email, password_hash, created_at FROM users WHERE lower(email) = $1',
    [email],
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
  }
  const refreshToken = await issueRefreshToken(pool, user.id);
  return { user: toPublicUser(user), refreshToken };
}

type RotateResult =
  { kind: 'ok'; session: Session } | { kind: 'invalid' } | { kind: 'reuse'; userId: string };

/** Ротация: старый токен отзывается, выдаётся новый. Повтор отозванного — отзыв всех сессий. */
export async function rotateRefreshToken(raw: string): Promise<Session> {
  const result = await withTransaction<RotateResult>(async (c) => {
    const { rows } = await c.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      replaced_by: string | null;
    }>(
      `SELECT id, user_id, expires_at, revoked_at, replaced_by
       FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hashRefreshToken(raw)],
    );
    const token = rows[0];
    if (!token) return { kind: 'invalid' };

    if (token.revoked_at) {
      const recentlyRotated =
        token.replaced_by !== null && Date.now() - token.revoked_at.getTime() < REUSE_GRACE_MS;
      return recentlyRotated ? { kind: 'invalid' } : { kind: 'reuse', userId: token.user_id };
    }
    if (token.expires_at.getTime() <= Date.now()) return { kind: 'invalid' };

    const next = generateRefreshToken();
    const inserted = await c.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
      [token.user_id, next.hash, refreshExpiresAt()],
    );
    await c.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [
      token.id,
      inserted.rows[0]!.id,
    ]);
    const user = await c.query<UserRow>(
      'SELECT id, email, password_hash, created_at FROM users WHERE id = $1',
      [token.user_id],
    );
    return { kind: 'ok', session: { user: toPublicUser(user.rows[0]!), refreshToken: next.raw } };
  });

  if (result.kind === 'ok') return result.session;
  if (result.kind === 'reuse') await revokeAllRefreshTokens(result.userId);
  throw new AppError(401, 'REFRESH_INVALID', 'Сессия истекла, войди заново');
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashRefreshToken(raw)],
  );
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
}

export async function getUser(userId: string): Promise<PublicUser> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, email, password_hash, created_at FROM users WHERE id = $1',
    [userId],
  );
  if (!rows[0]) throw new AppError(401, 'UNAUTHORIZED', 'Пользователь не найден');
  return toPublicUser(rows[0]);
}

/** Удаление аккаунта: каскадом уходят все записи пользователя. */
export async function deleteAccount(userId: string, password: string): Promise<void> {
  const { rows } = await pool.query<Pick<UserRow, 'password_hash'>>(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверный пароль');
  }
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

async function issueRefreshToken(db: Db | PoolClient, userId: string): Promise<string> {
  const token = generateRefreshToken();
  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, token.hash, refreshExpiresAt()],
  );
  return token.raw;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
