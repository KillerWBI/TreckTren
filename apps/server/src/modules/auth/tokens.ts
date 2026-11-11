import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { AppError } from '../../errors.js';

interface AccessPayload {
  sub: string;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies AccessPayload, config.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.ACCESS_TOKEN_TTL_SEC,
  });
}

export function verifyAccessToken(token: string): string {
  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw new AppError(401, 'UNAUTHORIZED', 'Некорректный токен');
    }
    return payload.sub;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Токен истёк');
    }
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'UNAUTHORIZED', 'Некорректный токен');
  }
}

/** Refresh-токен: 32 случайных байта; в БД храним только SHA-256. */
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function refreshExpiresAt(): Date {
  return new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
