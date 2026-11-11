/** Коды ошибок API. Формат ответа: { error: { code, message, details? } }. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'CARD_INVALID',
  'CARD_SECTION_FORBIDDEN',
  'VERSION_CONFLICT',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'REFRESH_INVALID',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}
