import type { ApiErrorBody, AuthMode, AuthResponse, ErrorCode } from '@trektren/shared';

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
let authMode: AuthMode = 'password';
let refreshing: Promise<AuthResponse | null> | null = null;
let onSessionLost: () => void = () => {};

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setAuthMode(mode: AuthMode): void {
  authMode = mode;
}

export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

async function requestSession(path: '/auth/refresh' | '/auth/demo'): Promise<AuthResponse | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as AuthResponse;
  } catch {
    return null;
  }
}

/**
 * Обновляет access-токен по refresh-cookie. В демо-режиме, если сессии нет или она
 * истекла, сразу открывает сессию тестового аккаунта. Параллельные вызовы делят один
 * запрос: иначе две вкладки или двойной эффект StrictMode сожгут токен друг другу.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    let session = await requestSession('/auth/refresh');
    if (!session && authMode === 'demo') session = await requestSession('/auth/demo');
    accessToken = session?.accessToken ?? null;
    return session;
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
