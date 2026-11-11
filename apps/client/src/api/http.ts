import type { ApiErrorBody, AuthResponse, ErrorCode } from '@trektren/shared';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
let onSessionLost: () => void = () => {};

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

/**
 * Обновляет access-токен по refresh-cookie. Параллельные вызовы делят один запрос:
 * иначе две вкладки или двойной эффект StrictMode сожгут токен друг другу.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const body = (await res.json()) as AuthResponse;
      accessToken = body.accessToken;
      return body;
    } catch {
      return null;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  json?: unknown;
  /** Не пытаться обновить токен на 401 (вход, регистрация). */
  noRefresh?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = () => {
    const headers: Record<string, string> = {};
    if (options.json !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && !options.noRefresh) {
      const session = await refreshSession();
      if (!session) {
        onSessionLost();
        throw new ApiError(401, 'UNAUTHORIZED', 'Сессия закончилась, войди снова');
      }
      res = await send();
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'NETWORK', 'Нет связи с сервером. Проверь интернет и повтори.');
  }

  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? 'Сервер ответил ошибкой',
      error?.details,
    );
  }
  return body as T;
}

/** Ошибки полей из ответа сервера: { 'basics.heightCm': 'Не больше 230' }. */
export function fieldErrorsFrom(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return {};
  const result: Record<string, string> = {};
  for (const item of err.details as Array<{ path?: unknown; message?: unknown }>) {
    if (typeof item.path === 'string' && typeof item.message === 'string') {
      result[item.path] ??= item.message;
    }
  }
  return result;
}
