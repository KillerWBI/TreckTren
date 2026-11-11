import { describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { api, bearer, extractRefreshCookie, registerUser } from './helpers.js';

describe('регистрация', () => {
  it('создаёт пользователя, профиль, онбординг и ставит httpOnly refresh-cookie', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({
        email: 'Artem@Example.com',
        password: 'secret-pass-1',
        healthConsent: true,
        adultConfirmed: true,
      })
      .expect(201);

    expect(res.body.user.email).toBe('artem@example.com');
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.expiresIn).toBe(900);

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('trektren_rt='),
    );
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Strict/);

    const { rows } = await pool.query(
      `SELECT u.health_consent_at, p.card_version, o.step
       FROM users u JOIN profiles p ON p.user_id = u.id JOIN onboarding o ON o.user_id = u.id`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].health_consent_at).toBeInstanceOf(Date);
    expect(rows[0].card_version).toBe(0);
  });

  it('без согласия на данные о здоровье — 400', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({
        email: 'a@example.com',
        password: 'secret-pass-1',
        healthConsent: false,
        adultConfirmed: true,
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toContainEqual(
      expect.objectContaining({ path: 'healthConsent' }),
    );
  });

  it('без подтверждения 18+ — 400', async () => {
    await api()
      .post('/api/v1/auth/register')
      .send({ email: 'a@example.com', password: 'secret-pass-1', healthConsent: true })
      .expect(400);
  });

  it('короткий пароль — 400', async () => {
    await api()
      .post('/api/v1/auth/register')
      .send({
        email: 'a@example.com',
        password: 'short',
        healthConsent: true,
        adultConfirmed: true,
      })
      .expect(400);
  });

  it('повторный email (в другом регистре) — 409 EMAIL_TAKEN', async () => {
    await registerUser({ email: 'dup@example.com' });
    const res = await api()
      .post('/api/v1/auth/register')
      .send({
        email: 'DUP@example.com',
        password: 'secret-pass-1',
        healthConsent: true,
        adultConfirmed: true,
      })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('пароль хранится только как bcrypt-хэш', async () => {
    const user = await registerUser();
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [
      user.userId,
    ]);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
    expect(rows[0].password_hash).not.toContain(user.password);
  });
});

describe('вход и /me', () => {
  it('вход по верному паролю, /me отдаёт пользователя', async () => {
    const user = await registerUser();
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email.toUpperCase(), password: user.password })
      .expect(200);
    const me = await api().get('/api/v1/me').set(bearer(res.body.accessToken)).expect(200);
    expect(me.body).toEqual({ id: user.userId, email: user.email, createdAt: expect.any(String) });
  });

  it('неверный пароль и несуществующий email дают одинаковый ответ', async () => {
    const user = await registerUser();
    const wrong = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'nope-nope' })
      .expect(401);
    const missing = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'nope-nope' })
      .expect(401);
    expect(wrong.body).toEqual(missing.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('без токена — 401, с битым токеном — 401', async () => {
    const none = await api().get('/api/v1/me').expect(401);
    expect(none.body.error.code).toBe('UNAUTHORIZED');
    await api().get('/api/v1/me').set(bearer('not-a-jwt')).expect(401);
  });
});

describe('refresh-токены', () => {
  it('ротация: новый токен работает, старый — нет', async () => {
    const user = await registerUser();
    const first = await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(200);
    const nextCookie = extractRefreshCookie(first.headers['set-cookie']);
    expect(nextCookie).not.toBe(user.refreshCookie);

    await api().post('/api/v1/auth/refresh').set('Cookie', nextCookie).expect(200);
  });

  it('повтор старого токена после окна — отзыв всех сессий', async () => {
    const user = await registerUser();
    const first = await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(200);
    const nextCookie = extractRefreshCookie(first.headers['set-cookie']);

    // Старый токен «отозван давно»: сдвигаем время отзыва за окно в 10 секунд.
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute' WHERE revoked_at IS NOT NULL`,
    );
    const reuse = await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(401);
    expect(reuse.body.error.code).toBe('REFRESH_INVALID');

    // Украденную цепочку тоже отрезало.
    await api().post('/api/v1/auth/refresh').set('Cookie', nextCookie).expect(401);
  });

  it('повтор в окне 10 секунд (две вкладки) — 401 без отзыва остальных сессий', async () => {
    const user = await registerUser();
    const first = await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(200);
    const nextCookie = extractRefreshCookie(first.headers['set-cookie']);

    await api().post('/api/v1/auth/refresh').set('Cookie', user.refreshCookie).expect(401);
    await api().post('/api/v1/auth/refresh').set('Cookie', nextCookie).expect(200);
  });

  it('без cookie — 401', async () => {
    await api().post('/api/v1/auth/refresh').expect(401);
  });

  it('logout отзывает токен', async () => {
    const user = await registerUser();
    await api().post('/api/v1/auth/logout').set('Cookie', user.refreshCookie).expect(204);
    await api().post('/api/v1/auth/refresh').set('Cookie', user.refreshCookie).expect(401);
  });
});

describe('удаление аккаунта', () => {
  it('удаляет пользователя и все его записи', async () => {
    const user = await registerUser();
    await api()
      .patch('/api/v1/card')
      .set(bearer(user.accessToken))
      .send({ patch: { basics: { heightCm: 180 } } })
      .expect(200);

    await api()
      .delete('/api/v1/account')
      .set(bearer(user.accessToken))
      .send({ password: 'wrong' })
      .expect(401);
    await api()
      .delete('/api/v1/account')
      .set(bearer(user.accessToken))
      .send({ password: user.password })
      .expect(204);

    for (const table of ['users', 'profiles', 'card_versions', 'onboarding', 'refresh_tokens']) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0].n, table).toBe(0);
    }
  });
});

describe('ошибки', () => {
  it('битый JSON — 400 в общем формате', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(res.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Некорректный JSON' } });
  });

  it('неизвестный маршрут — 404 в общем формате', async () => {
    const res = await api().get('/api/v1/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
