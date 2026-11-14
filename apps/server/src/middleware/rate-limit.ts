import { rateLimit } from 'express-rate-limit';
import type { ApiErrorBody } from '@trektren/shared';
import { isTest } from '../config.js';

const limitedBody: ApiErrorBody = {
  error: { code: 'RATE_LIMITED', message: 'Слишком много попыток, попробуй позже' },
};

/** Вход и регистрация: 20 попыток за 15 минут с одного IP. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => isTest,
  message: limitedBody,
});

/** Обновление токена: 60 запросов за 15 минут. */
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => isTest,
  message: limitedBody,
});

/** Запросы к ИИ: не больше 10 в минуту на человека — кроме суточного лимита по задачам. */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: (req) => (req as { userId?: string }).userId ?? 'anon',
  message: {
    error: { code: 'RATE_LIMITED', message: 'Слишком часто — подожди минуту' },
  } satisfies ApiErrorBody,
});
