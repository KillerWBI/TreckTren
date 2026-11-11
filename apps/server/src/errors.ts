import type { ErrorCode } from '@trektren/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (message = 'Не найдено') => new AppError(404, 'NOT_FOUND', message);
export const unauthorized = (message = 'Нужна авторизация') =>
  new AppError(401, 'UNAUTHORIZED', message);
