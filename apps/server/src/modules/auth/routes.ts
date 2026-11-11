import { Router, type CookieOptions, type RequestHandler, type Response } from 'express';
import {
  deleteAccountRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  type AuthMode,
  type AuthModeResponse,
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

/**
 * Маршруты авторизации. В демо-режиме регистрации, входа и удаления аккаунта нет:
 * клиент получает сессию тестового аккаунта через POST /auth/demo.
 * Токены, ротация refresh и защита маршрутов работают одинаково в обоих режимах.
 */
export function createAuthRouter(mode: AuthMode) {
  const router = Router();
  const demo = mode === 'demo';

  const disabledInDemo: RequestHandler = (_req, _res, next) => {
    if (demo) {
      throw new AppError(403, 'FEATURE_DISABLED', 'Регистрация и вход временно отключены');
    }
    next();
  };

  router.get('/auth/mode', (_req, res) => {
    const body: AuthModeResponse = { mode };
    res.json(body);
  });

  router.post('/auth/demo', refreshLimiter, async (_req, res) => {
    if (!demo) throw new AppError(404, 'NOT_FOUND', 'Маршрут не найден');
    sendSession(res, await auth.demoSession());
  });

  router.post('/auth/register', disabledInDemo, authLimiter, async (req, res) => {
    const { email, password } = parseBody(registerRequestSchema, req.body);
    sendSession(res, await auth.register(email, password), 201);
  });

  router.post('/auth/login', disabledInDemo, authLimiter, async (req, res) => {
    const { email, password } = parseBody(loginRequestSchema, req.body);
    sendSession(res, await auth.login(email, password));
  });

  router.post('/auth/refresh', refreshLimiter, async (req, res) => {
    const raw = readRefreshCookie(req.cookies);
    if (!raw) throw new AppError(401, 'REFRESH_INVALID', 'Сессия истекла, войди заново');
    try {
      const session = await auth.rotateRefreshToken(raw);
      // Демо выключили: старые сессии тестового аккаунта больше не продлеваются.
      if (!demo && session.user.email === auth.DEMO_EMAIL) {
        await auth.revokeAllRefreshTokens(session.user.id);
        throw new AppError(401, 'REFRESH_INVALID', 'Сессия истекла, войди заново');
      }
      sendSession(res, session);
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, cookieOptions());
      throw err;
    }
  });

  router.post('/auth/logout', async (req, res) => {
    const raw = readRefreshCookie(req.cookies);
    if (raw) await auth.revokeRefreshToken(raw);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    res.status(204).end();
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json(await auth.getUser(userIdOf(req)));
  });

  // В демо тестовый аккаунт общий: удалить его может любой, у кого есть ссылка.
  router.delete('/account', requireAuth, disabledInDemo, async (req, res) => {
    const { password } = parseBody(deleteAccountRequestSchema, req.body);
    await auth.deleteAccount(userIdOf(req), password);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    res.status(204).end();
  });

  return router;
}
