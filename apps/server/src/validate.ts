import type { z } from 'zod';
import { AppError } from './errors.js';

/** Проверяет вход по схеме; при ошибке — 400 VALIDATION_ERROR со списком полей. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Некорректные данные', formatIssues(result.error));
  }
  return result.data;
}

export function formatIssues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
