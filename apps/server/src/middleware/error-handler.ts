import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@trektren/shared';
import { AppError } from '../errors.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Маршрут не найден' } };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof AppError) {
    const body: ApiErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    res.status(err.status).json(body);
    return;
  }

  // Битый JSON в теле запроса от express.json().
  if (isBodyParserError(err)) {
    const body: ApiErrorBody = {
      error: { code: 'VALIDATION_ERROR', message: 'Некорректный JSON' },
    };
    res.status(400).json(body);
    return;
  }

  // В лог — только тип и стек, без тела запроса: там могут быть данные о здоровье.
  console.error('[error]', err instanceof Error ? err.stack : err);
  const body: ApiErrorBody = { error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } };
  res.status(500).json(body);
};

function isBodyParserError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.parse.failed'
  );
}
