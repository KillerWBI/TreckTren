import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AthleteCard, MeasurementsResponse, PortraitResponse } from '@trektren/shared';
import { disabledAi } from '../src/ai/client.js';
import { createApp } from '../src/app.js';
import { addDays, todayIn } from '../src/dates.js';
import { pool } from '../src/db.js';
import { dueFor } from '../src/modules/measurements/service.js';
import { bodyFatFromTape } from '../src/modules/progress/portrait.js';
import { bearer, registerUser } from './helpers.js';

const app = createApp({ authMode: 'password', ai: disabledAi });
const today = todayIn('Europe/Warsaw');

async function athlete() {
  const user = await registerUser();
  const auth = bearer(user.accessToken);
  const card: AthleteCard = { basics: { sex: 'male', heightCm: 180, weightKg: 80 } };
  await request(app).patch('/api/v1/card').set(auth).send({ patch: card }).expect(200);
  return { user, auth };
}

describe('замеры: когда перемерять', () => {
  it('нет замеров, свежие, скоро, пора, вес сильно изменился', () => {
    expect(dueFor(undefined, today, 80).status).toBe('none');
    expect(dueFor({ date: addDays(today, -3), weightKg: 80 }, today, 80)).toMatchObject({
      status: 'ok',
      daysSince: 3,
    });
    expect(dueFor({ date: addDays(today, -22), weightKg: 80 }, today, 80).status).toBe('soon');
    expect(dueFor({ date: addDays(today, -28), weightKg: 80 }, today, 80).status).toBe('due');
    expect(dueFor({ date: addDays(today, -12), weightKg: 80 }, today, 77.5)).toMatchObject({
      status: 'due',
      message: expect.stringMatching(/−2,5 кг/),
    });
    // Через 5 дней даже большой сдвиг веса — ещё не повод: это вода, а не тело.
    expect(dueFor({ date: addDays(today, -5), weightKg: 80 }, today, 77).status).toBe('ok');
  });

  it('жир по ленте: мужчина по шее и талии, женщине нужны бёдра', () => {
    expect(bodyFatFromTape({ neck: 38, waist: 84 }, 180, false)).toBe(15);
    expect(bodyFatFromTape({ neck: 33, waist: 72 }, 165, true)).toBeNull();
    expect(bodyFatFromTape({ neck: 33, waist: 72, hips: 98 }, 165, true)).toBeGreaterThan(20);
    expect(bodyFatFromTape({ waist: 84 }, 180, false)).toBeNull();
  });
});

describe('замеры: API и портрет', () => {
  it('сохранить, дополнить за тот же день, портрет по замерам, старый снимок для сравнения', async () => {
    const { auth } = await athlete();
    const empty = (await request(app).get('/api/v1/measurements').set(auth).expect(200))
      .body as MeasurementsResponse;
    expect(empty).toMatchObject({ entries: [], due: { status: 'none' } });

    // Вне диапазона и пусто — 400.
    await request(app).put('/api/v1/measurements').set(auth).send({ waist: 300 }).expect(400);
    await request(app).put('/api/v1/measurements').set(auth).send({}).expect(400);
    await request(app)
      .put('/api/v1/measurements')
      .set(auth)
      .send({ date: addDays(today, 1), waist: 80 })
      .expect(400);

    const old = addDays(today, -30);
    await request(app)
      .put('/api/v1/measurements')
      .set(auth)
      .send({ date: old, neck: 38, waist: 90, arm: 33 })
      .expect(200);
    // Тот же день — дополняет, а не затирает.
    const merged = (
      await request(app)
        .put('/api/v1/measurements')
        .set(auth)
        .send({ date: old, chest: 101 })
        .expect(200)
    ).body as MeasurementsResponse;
    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0]!.girths).toEqual({ neck: 38, waist: 90, arm: 33, chest: 101 });
    expect(merged.due.status).toBe('due');

    const fresh = (
      await request(app).put('/api/v1/measurements').set(auth).send({ waist: 85.25 }).expect(200)
    ).body as MeasurementsResponse;
    expect(fresh.entries.map((e) => e.date)).toEqual([today, old]);
    expect(fresh.entries[0]!.girths).toEqual({ waist: 85.3 });
    expect(fresh.due.status).toBe('ok');

    const p = (await request(app).get('/api/v1/portrait').set(auth).expect(200))
      .body as PortraitResponse;
    // Свежайшее по каждой мере: талия новая, остальное — из прошлого раза.
    expect(p.body.girths).toEqual({ neck: 38, waist: 85.3, arm: 33, chest: 101 });
    expect(p.body.girthsDate).toBe(today);
    expect(p.body.bodyFatSource).toBe('tape');
    expect(p.snapshots).toHaveLength(1);
    expect(p.snapshots[0]).toMatchObject({ date: old, body: { girths: { waist: 90 } } });

    // Удалить можно только свой замер.
    const other = await registerUser();
    await request(app)
      .delete(`/api/v1/measurements/${fresh.entries[0]!.id}`)
      .set(bearer(other.accessToken))
      .expect(404);
    await request(app).delete('/api/v1/measurements/not-a-uuid').set(auth).expect(404);
    const left = (
      await request(app)
        .delete(`/api/v1/measurements/${fresh.entries[0]!.id}`)
        .set(auth)
        .expect(200)
    ).body as MeasurementsResponse;
    expect(left.entries).toHaveLength(1);
  });

  it('введённый процент жира важнее ленты; удаление аккаунта уносит замеры', async () => {
    const { user, auth } = await athlete();
    await request(app)
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { basics: { bodyFatPct: 12 } } })
      .expect(200);
    await request(app)
      .put('/api/v1/measurements')
      .set(auth)
      .send({ neck: 38, waist: 95 })
      .expect(200);
    const p = (await request(app).get('/api/v1/portrait').set(auth).expect(200))
      .body as PortraitResponse;
    expect(p.body).toMatchObject({ bodyFatPct: 12, bodyFatSource: 'entered' });

    await pool.query('DELETE FROM users WHERE id = $1', [user.userId]);
    const { rows } = await pool.query('SELECT 1 FROM measurement_logs WHERE user_id = $1', [
      user.userId,
    ]);
    expect(rows).toHaveLength(0);
  });
});
