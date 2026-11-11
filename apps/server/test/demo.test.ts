import { describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { DEMO_EMAIL } from '../src/modules/auth/service.js';
import { api, bearer, demoApi, extractRefreshCookie } from './helpers.js';

describe('демо-режим', () => {
  it('сообщает режим клиенту', async () => {
    await demoApi().get('/api/v1/auth/mode').expect(200, { mode: 'demo' });
    await api().get('/api/v1/auth/mode').expect(200, { mode: 'password' });
  });

  it('первый вход создаёт тестовый аккаунт, следующие попадают в тот же', async () => {
    const first = await demoApi().post('/api/v1/auth/demo').expect(200);
    const second = await demoApi().post('/api/v1/auth/demo').expect(200);

    expect(first.body.user.email).toBe(DEMO_EMAIL);
    expect(second.body.user.id).toBe(first.body.user.id);
    expect(first.body.accessToken).toEqual(expect.any(String));
    expect(extractRefreshCookie(first.headers['set-cookie'])).toMatch(/^trektren_rt=/);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS users,
              (SELECT count(*)::int FROM profiles) AS profiles,
              (SELECT count(*)::int FROM onboarding) AS onboarding
       FROM users`,
    );
    expect(rows[0]).toEqual({ users: 1, profiles: 1, onboarding: 1 });
  });

  it('одновременные первые входы не падают и не плодят аккаунты', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => demoApi().post('/api/v1/auth/demo')),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.body.user.id)).size).toBe(1);
  });

  it('с демо-сессией работают карточка и обновление токена', async () => {
    const session = await demoApi().post('/api/v1/auth/demo').expect(200);
    const auth = bearer(session.body.accessToken);

    await demoApi()
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { goals: { primary: 'strength' } } })
      .expect(200);
    const card = await demoApi().get('/api/v1/card').set(auth).expect(200);
    expect(card.body.card).toEqual({ goals: { primary: 'strength' } });

    const cookie = extractRefreshCookie(session.headers['set-cookie']);
    await demoApi().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200);
  });

  it('регистрация, вход и удаление аккаунта выключены', async () => {
    const register = await demoApi()
      .post('/api/v1/auth/register')
      .send({
        email: 'a@example.com',
        password: 'secret-pass-1',
        healthConsent: true,
        adultConfirmed: true,
      })
      .expect(403);
    expect(register.body.error.code).toBe('FEATURE_DISABLED');

    await demoApi()
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.com', password: 'secret-pass-1' })
      .expect(403);

    const session = await demoApi().post('/api/v1/auth/demo').expect(200);
    const remove = await demoApi()
      .delete('/api/v1/account')
      .set(bearer(session.body.accessToken))
      .send({ password: 'anything' })
      .expect(403);
    expect(remove.body.error.code).toBe('FEATURE_DISABLED');

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0].n).toBe(1);
  });

  it('в обычном режиме демо-входа нет', async () => {
    await api().post('/api/v1/auth/demo').expect(404);
  });

  it('после выключения демо старые демо-сессии не продлеваются', async () => {
    const session = await demoApi().post('/api/v1/auth/demo').expect(200);
    const cookie = extractRefreshCookie(session.headers['set-cookie']);

    await api().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE revoked_at IS NULL',
    );
    expect(rows[0].n).toBe(0);
  });

  it('в тестовый аккаунт нельзя войти по паролю', async () => {
    await demoApi().post('/api/v1/auth/demo').expect(200);
    await api()
      .post('/api/v1/auth/login')
      .send({ email: DEMO_EMAIL, password: 'dummy-password' })
      .expect(401);
  });
});
