import { Router, type CookieOptions, type Response } from 'express';
import {
  deleteAccountRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
} from '@trektren/shared';
import { config, isProd } from '../../config.js';
import { AppError } from '../../errors.js';
import { requireAuth, userIdOf } from '../../middleware/auth.js';
import { authLimiter, refreshLimiter } from '../../middleware/rate-limit.js';
import { parseBody } from '../../validate.js';
import * as auth from './service.js';
import { signAccessToken } from './tokens.js';

export const REFRESH_COOKIE = 'trektren_rt';
const COOKIE_PATH = '/api/v1/auth';

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: isProd || config.COOKIE_SAMESITE === 'none',
  sameSite: config.COOKIE_SAMESITE,
  path: COOKIE_PATH,
});

function sendSession(res: Response, session: auth.Session, status = 200): void {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...cookieOptions(),
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
  const body: AuthResponse = {
    accessToken: signAccessToken(session.user.id),
    expiresIn: config.ACCESS_TOKEN_TTL_SEC,
    user: session.user,
  };
  res.status(status).json(body);
}

function readRefreshCookie(cookies: unknown): string | undefined {
  const value = (cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const authRouter = Router();

authRouter.post('/auth/register', authLimiter, async (req, res) => {
  const { email, password } = parseBody(registerRequestSchema, req.body);
  sendSession(res, await auth.register(email, password), 201);
});

authRouter.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = parseBody(loginRequestSchema, req.body);
  sendSession(res, await auth.login(email, password));
});

authRouter.post('/auth/refresh', refreshLimiter, async (req, res) => {
  const raw = readRefreshCookie(req.cookies);
  if (!raw) throw new AppError(401, 'REFRESH_INVALID', 'Сессия истекла, войди заново');
  try {
    sendSession(res, await auth.rotateRefreshToken(raw));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    throw err;
  }
});

authRouter.post('/auth/logout', async (req, res) => {
  const raw = readRefreshCookie(req.cookies);
  if (raw) await auth.revokeRefreshToken(raw);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await auth.getUser(userIdOf(req)));
});

authRouter.delete('/account', requireAuth, async (req, res) => {
  const { password } = parseBody(deleteAccountRequestSchema, req.body);
  await auth.deleteAccount(userIdOf(req), password);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
});
