import { describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { applyCardPatch } from '../src/modules/card/service.js';
import { api, bearer, registerUser } from './helpers.js';

describe('карточка атлета', () => {
  it('новая карточка пустая, версия 0', async () => {
    const user = await registerUser();
    const res = await api().get('/api/v1/card').set(bearer(user.accessToken)).expect(200);
    expect(res.body).toEqual({ card: {}, version: 0, updatedAt: expect.any(String) });
  });

  it('PATCH сливает разделы и создаёт версию', async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);

    await api()
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { basics: { sex: 'male', heightCm: 180, weightKg: 80 } }, reason: 'Анкета' })
      .expect(200);
    const res = await api()
      .patch('/api/v1/card')
      .set(auth)
      .send({
        patch: {
          basics: { weightKg: 82 },
          availability: { sessionsPerWeek: 2, usualDays: [3, 6] },
        },
      })
      .expect(200);

    expect(res.body.version).toBe(2);
    expect(res.body.changed).toBe(true);
    expect(res.body.card).toEqual({
      basics: { sex: 'male', heightCm: 180, weightKg: 82 },
      availability: { sessionsPerWeek: 2, usualDays: [3, 6] },
    });
  });

  it('null удаляет поле', async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    await api()
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { basics: { heightCm: 180, weightKg: 80 } } });
    const res = await api()
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { basics: { weightKg: null } } })
      .expect(200);
    expect(res.body.card).toEqual({ basics: { heightCm: 180 } });
  });

  it('тот же патч повторно — версия не растёт', async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    const patch = { goals: { primary: 'strength' } };
    await api().patch('/api/v1/card').set(auth).send({ patch }).expect(200);
    const res = await api().patch('/api/v1/card').set(auth).send({ patch }).expect(200);
    expect(res.body.version).toBe(1);
    expect(res.body.changed).toBe(false);
  });

  it('невалидное значение — 422 CARD_INVALID, карточка не меняется', async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    const res = await api()
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { availability: { sessionsPerWeek: 12 } } })
      .expect(422);
    expect(res.body.error.code).toBe('CARD_INVALID');
    expect(res.body.error.details[0].path).toBe('availability.sessionsPerWeek');

    const card = await api().get('/api/v1/card').set(auth).expect(200);
    expect(card.body.version).toBe(0);
  });

  it('опечатка в ключе — 422, а не тихое сохранение', async () => {
    const user = await registerUser();
    await api()
      .patch('/api/v1/card')
      .set(bearer(user.accessToken))
      .send({ patch: { basics: { heigth: 180 } } })
      .expect(422);
  });

  it('человек не может менять силовые, прогноз и заметки тренера', async () => {
    const user = await registerUser();
    const res = await api()
      .patch('/api/v1/card')
      .set(bearer(user.accessToken))
      .send({
        patch: {
          strength: {
            lifts: { squat: { oneRmKg: 300, estimated: false, updatedAt: '2026-11-10' } },
          },
        },
      })
      .expect(403);
    expect(res.body.error.code).toBe('CARD_SECTION_FORBIDDEN');
    expect(res.body.error.details.sections).toEqual(['strength']);
  });

  it('код и ИИ меняют свои разделы через сервис', async () => {
    const user = await registerUser();
    const result = await applyCardPatch(
      user.userId,
      {
        strength: {
          lifts: { 'barbell-squat': { oneRmKg: 120, estimated: true, updatedAt: '2026-11-10' } },
        },
      },
      { source: 'ai', reason: 'Калибровочная неделя', allowedSections: ['strength'] },
    );
    expect(result.version).toBe(1);
    const versions = await api()
      .get('/api/v1/card/versions')
      .set(bearer(user.accessToken))
      .expect(200);
    expect(versions.body[0]).toMatchObject({
      version: 1,
      source: 'ai',
      changedSections: ['strength'],
    });
  });

  it('baseVersion отстала — 409 VERSION_CONFLICT', async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    await api()
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { goals: { primary: 'strength' } } });
    const res = await api()
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { goals: { primary: 'hypertrophy' } }, baseVersion: 0 })
      .expect(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect(res.body.error.details.currentVersion).toBe(1);
  });

  it('__proto__ в патче отклоняется', async () => {
    const user = await registerUser();
    await api()
      .patch('/api/v1/card')
      .set(bearer(user.accessToken))
      .set('Content-Type', 'application/json')
      .send('{"patch":{"basics":{"__proto__":{"heightCm":1}}}}')
      .expect(400);
  });

  it('чужая карточка недоступна: каждый видит только свою', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await api()
      .patch('/api/v1/card')
      .set(bearer(a.accessToken))
      .send({ patch: { basics: { heightCm: 190 } } });
    const res = await api().get('/api/v1/card').set(bearer(b.accessToken)).expect(200);
    expect(res.body.card).toEqual({});
  });
});

describe('история версий', () => {
  it('список, снимок и откат', async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    await api()
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { goals: { primary: 'strength' } }, reason: 'Старт' });
    await api()
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { goals: { primary: 'hypertrophy' }, nutrition: { mealsPerDay: 4 } } });

    const list = await api().get('/api/v1/card/versions').set(auth).expect(200);
    expect(list.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(list.body[0]).toMatchObject({ source: 'user', changedSections: ['goals', 'nutrition'] });
    expect(list.body[1]).toMatchObject({ reason: 'Старт', changedSections: ['goals'] });

    const v1 = await api().get('/api/v1/card/versions/1').set(auth).expect(200);
    expect(v1.body.snapshot).toEqual({ goals: { primary: 'strength' } });

    const restored = await api().post('/api/v1/card/versions/1/restore').set(auth).expect(200);
    expect(restored.body).toMatchObject({
      version: 3,
      changed: true,
      card: { goals: { primary: 'strength' } },
    });

    const v3 = await api().get('/api/v1/card/versions/3').set(auth).expect(200);
    expect(v3.body).toMatchObject({
      reason: 'Откат к версии 1',
      changedSections: ['goals', 'nutrition'],
    });

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM card_versions');
    expect(rows[0].n).toBe(3);
  });

  it('несуществующая версия — 404, мусор в номере — 400', async () => {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    await api().get('/api/v1/card/versions/5').set(auth).expect(404);
    await api().get('/api/v1/card/versions/abc').set(auth).expect(400);
    await api().post('/api/v1/card/versions/5/restore').set(auth).expect(404);
  });
});
