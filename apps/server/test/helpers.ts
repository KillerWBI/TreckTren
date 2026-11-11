import request from 'supertest';
import type { AuthResponse } from '@trektren/shared';
import { createApp } from '../src/app.js';

/** Обычный режим с регистрацией и входом. */
export const app = createApp({ authMode: 'password' });
/** Демо-режим: все в одном тестовом аккаунте. */
export const demoApp = createApp({ authMode: 'demo' });

export const api = () => request(app);
export const demoApi = () => request(demoApp);

export interface TestUser {
  email: string;
  password: string;
  accessToken: string;
  refreshCookie: string;
  userId: string;
}

let counter = 0;

export async function registerUser(
  overrides: { email?: string; password?: string } = {},
): Promise<TestUser> {
  counter += 1;
  const email = overrides.email ?? `user${counter}@example.com`;
  const password = overrides.password ?? 'correct-horse-battery';
  const res = await api()
    .post('/api/v1/auth/register')
    .send({ email, password, healthConsent: true, adultConfirmed: true })
    .expect(201);
  const body = res.body as AuthResponse;
  return {
    email,
    password,
    accessToken: body.accessToken,
    refreshCookie: extractRefreshCookie(res.headers['set-cookie']),
    userId: body.user.id,
  };
}

/** Достаёт пару name=value refresh-cookie из Set-Cookie. */
export function extractRefreshCookie(header: string | string[] | undefined): string {
  const list = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = list.find((c) => c.startsWith('trektren_rt='));
  if (!cookie) throw new Error('refresh-cookie не установлена');
  return cookie.split(';')[0]!;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
