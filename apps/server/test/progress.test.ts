import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type {
  AthleteCard,
  DayResponse,
  PortraitResponse,
  ProgressResponse,
  WeeklyReview,
} from '@trektren/shared';
import { AiError, disabledAi, type AiProvider } from '../src/ai/client.js';
import { createApp } from '../src/app.js';
import { addDays, todayIn } from '../src/dates.js';
import { pool } from '../src/db.js';
import { decide } from '../src/modules/progress/weekly.js';
import { estimateBodyFat, muscleDetails, muscleLevels } from '../src/modules/progress/portrait.js';
import { bearer, registerUser } from './helpers.js';

const today = todayIn('Europe/Warsaw');
const artem: AthleteCard = {
  goals: { primary: 'strength_hypertrophy', priorityMuscles: ['quads', 'hamstrings'] },
  basics: { sex: 'male', heightCm: 178, weightKg: 70, birthDate: '2008-02-19' },
  availability: { sessionsPerWeek: 3, sessionMinutes: 100 },
  limitations: { injuries: [{ area: 'Колено', description: 'Ноет после бега' }] },
  weakPoints: [
    {
      id: 'wp1',
      area: 'присед со штангой',
      status: 'testing',
      source: 'user',
      updatedAt: '2026-11-12',
    },
    {
      id: 'wp2',
      area: 'Жим штанги стоя',
      cause: 'Жиму стоя не хватает частоты.',
      status: 'confirmed',
      source: 'ai',
      updatedAt: '2026-11-12',
    },
  ],
};

async function person(card: AthleteCard = artem, ai: AiProvider = disabledAi) {
  const app = createApp({ authMode: 'password', ai });
  const user = await registerUser();
  const auth = bearer(user.accessToken);
  await request(app).patch('/api/v1/card').set(auth).send({ patch: card }).expect(200);
  return { app, user, auth, call: () => request(app) };
}

describe('портрет', () => {
  it('мышцы по силовым относительно веса тела', () => {
    const card: AthleteCard = {
      basics: { sex: 'male' },
      strength: {
        lifts: {
          'barbell-back-squat': { oneRmKg: 120, estimated: false, updatedAt: '2026-11-12' },
          'bench-press': { oneRmKg: 100, estimated: false, updatedAt: '2026-11-12' },
          deadlift: { oneRmKg: 170, estimated: false, updatedAt: '2026-11-12' },
        },
      },
    };
    const levels = muscleLevels(card, 70);
    expect(levels.quads).toBeCloseTo(0.61, 2);
    expect(levels.chest).toBeCloseTo(0.71, 2);
    expect(levels.hamstrings).toBeCloseTo(0.71, 2);
    expect(levels.shoulders).toBeCloseTo(0.64, 2);
    expect(levels.biceps).toBeCloseTo(0.71, 2);
    expect(muscleLevels({}, 70).chest).toBeNull();
    expect(estimateBodyFat(22.1, 18, false)).toBe(14);
  });

  it('отстающая мышца: до скольки догнать остальное тело', () => {
    const lift = (oneRmKg: number) => ({ oneRmKg, estimated: false, updatedAt: '2026-11-12' });
    const card: AthleteCard = {
      basics: { sex: 'male', heightCm: 180, weightKg: 80 },
      strength: {
        lifts: {
          'barbell-back-squat': lift(160),
          'bench-press': lift(120),
          deadlift: lift(200),
          'overhead-press': lift(50),
          'barbell-row': lift(100),
        },
      },
    };
    const body = {
      sex: 'male' as const,
      heightCm: 180,
      weightKg: 80,
      bodyFatPct: 15,
      bodyFatEstimated: true,
      levels: muscleLevels(card, 80),
    };
    const { muscles, median } = muscleDetails({
      card,
      body,
      exercises: [],
      inPlan: new Set(),
      weak: new Map(),
      injuries: [],
    });
    expect(median).toBeGreaterThan(0.5);
    const shoulders = muscles.find((m) => m.group === 'shoulders')!;
    expect(shoulders.status).toBe('weak');
    expect(shoulders.catchUp).toMatchObject({ slug: 'overhead-press' });
    expect(shoulders.catchUp!.kg).toBeGreaterThan(70);
    expect(shoulders.summary).toMatch(/заметно отстают/);
    expect(muscles.find((m) => m.group === 'chest')!.status).toBe('good');
  });

  it('по данным человека: травмы, слабые места, заполненность, начало пути', async () => {
    const { auth, call } = await person();
    await call()
      .put('/api/v1/strength')
      .set(auth)
      .send({
        lifts: [
          { slug: 'barbell-back-squat', testedKg: 120 },
          { slug: 'bench-press', testedKg: 100 },
        ],
      })
      .expect(200);
    const p = (await call().get('/api/v1/portrait').set(auth).expect(200)).body as PortraitResponse;
    expect(p.body).toMatchObject({
      sex: 'male',
      heightCm: 178,
      weightKg: 70,
      bodyFatEstimated: true,
    });
    expect(p.weightSource).toBe('card');
    expect(p.bmi).toBe(22.1);
    expect(p.age).toBeGreaterThanOrEqual(18);
    expect(p.body.levels.quads).toBeGreaterThan(0.5);
    expect(p.injuries).toEqual([{ zone: 'knee', area: 'Колено' }]);
    expect(p.weak).toEqual(expect.arrayContaining(['quads']));
    expect(p.priority).toEqual(['quads', 'hamstrings']);
    expect(p.completeness).toEqual({ filled: 6, total: 11 });
    expect(p.start).toMatchObject({ body: { weightKg: 70 } });
    expect(p.strengthLabel).toBeTruthy();

    // По нажатию на мышцу: статус, движение, цель, упражнения.
    const by = new Map(p.muscles.map((m) => [m.group, m]));
    expect(p.muscles).toHaveLength(13);
    expect(by.get('adductors')).toMatchObject({ proxy: true });
    expect(by.get('adductors')!.exercises.map((e) => e.slug)).toContain('hip-adduction');
    const quads = by.get('quads')!;
    expect(quads).toMatchObject({ status: 'weak', priority: true, proxy: false });
    expect(quads.weak).toMatchObject({ area: 'присед со штангой' });
    expect(quads.injury).toMatch(/Колено/);
    expect(quads.lifts[0]).toMatchObject({
      slug: 'barbell-back-squat',
      oneRmKg: 120,
      source: 'tested',
    });
    expect(quads.lifts[0]!.ratio).toBeCloseTo(1.71, 2);
    expect(quads.lifts[0]!.next).toMatchObject({ tier: 'продвинутый', kg: 140 });
    expect(quads.levelWord).toBe('средний');
    expect(quads.blockedByInjury).toContain('Присед со штангой');
    expect(quads.summary).toMatch(/слабым местом/);
    // Колено ноет — приседы и выпады убраны, остаётся то, что колено не задевает.
    expect(quads.exercises.length).toBeGreaterThan(0);
    expect(quads.exercises.map((e) => e.slug)).not.toContain('barbell-back-squat');
    expect(quads.exercises.every((e) => !e.inPlan)).toBe(true);
    expect(by.get('chest')!.exercises.length).toBeGreaterThan(2);
    expect(by.get('chest')!.exercises[0]).toMatchObject({ primary: true, kind: 'kg' });
    // Становой нет — о бицепсе бедра судить не по чему.
    expect(by.get('hamstrings')).toMatchObject({ status: 'unknown', level: null });
    expect(by.get('hamstrings')!.summary).toMatch(/Нет данных/);
    // Жим 100 при весе 70 — 1,43 веса, в норме, следующая ступень — продвинутый.
    expect(by.get('chest')).toMatchObject({ status: 'good' });
    expect(by.get('chest')!.lifts[0]!.next).toMatchObject({ tier: 'продвинутый', kg: 105 });
    expect(by.get('abs')!.proxy).toBe(true);
    // «Жим штанги стоя» — это плечи, а не грудь.
    expect(by.get('shoulders')).toMatchObject({
      status: 'weak',
      weak: { area: 'Жим штанги стоя', cause: 'Жиму стоя не хватает частоты' },
    });

    // Утренние взвешивания важнее веса из карточки.
    for (const d of [0, 1, 2]) {
      await call()
        .put('/api/v1/weights')
        .set(auth)
        .send({ date: addDays(today, -d), timeOfDay: 'morning', weightKg: 72 })
        .expect(200);
    }
    const after = (await call().get('/api/v1/portrait').set(auth).expect(200))
      .body as PortraitResponse;
    expect(after).toMatchObject({ weightSource: 'average', body: { weightKg: 72 } });
  });
});

describe('сон и самочувствие, прогресс', () => {
  it('сон и самочувствие за день: частичная правка', async () => {
    const { auth, call } = await person();
    await call()
      .put(`/api/v1/wellbeing/${today}`)
      .set(auth)
      .send({ sleepHours: 7.5, sleepScore: 4 })
      .expect(200);
    const res = await call()
      .put(`/api/v1/wellbeing/${today}`)
      .set(auth)
      .send({ wellbeingScore: 2 })
      .expect(200);
    expect((res.body as DayResponse).wellbeing).toEqual({
      sleepHours: 7.5,
      sleepScore: 4,
      wellbeingScore: 2,
    });
    const cleared = await call()
      .put(`/api/v1/wellbeing/${today}`)
      .set(auth)
      .send({ sleepScore: null })
      .expect(200);
    expect((cleared.body as DayResponse).wellbeing.sleepScore).toBeNull();
    await call()
      .put(`/api/v1/wellbeing/${today}`)
      .set(auth)
      .send({ wellbeingScore: 9 })
      .expect(400);
  });

  it('графики: вес со средней, шаги, еда, силовые из тренировок', async () => {
    const { auth, call } = await person();
    for (let d = 0; d < 5; d += 1) {
      await call()
        .put('/api/v1/weights')
        .set(auth)
        .send({ date: addDays(today, -d), timeOfDay: 'morning', weightKg: 70 + d * 0.1 })
        .expect(200);
    }
    await call().put(`/api/v1/steps/${today}`).set(auth).send({ steps: 21000 }).expect(200);
    await call()
      .post('/api/v1/meals')
      .set(auth)
      .send({
        date: today,
        mealType: 'lunch',
        inputType: 'manual',
        title: 'Гречка',
        items: [{ name: 'Гречка', grams: 200, kcal: 220, proteinG: 8, fatG: 2, carbsG: 42 }],
      })
      .expect(201);
    await call()
      .put('/api/v1/strength')
      .set(auth)
      .send({ lifts: [{ slug: 'barbell-back-squat', testedKg: 120 }] })
      .expect(200);
    const w = await call().post('/api/v1/workouts').set(auth).send({}).expect(201);
    await call()
      .put(`/api/v1/workouts/${w.body.workout.id}/sets`)
      .set(auth)
      .send({ exerciseSlug: 'barbell-back-squat', setNo: 1, weightKg: 100, reps: 5, rir: 1 })
      .expect(200);
    await call()
      .post(`/api/v1/workouts/${w.body.workout.id}/finish`)
      .set(auth)
      .send({})
      .expect(200);

    const p = (await call().get('/api/v1/progress?days=30').set(auth).expect(200))
      .body as ProgressResponse;
    expect(p.days).toHaveLength(30);
    const last = p.days[p.days.length - 1]!;
    expect(last).toMatchObject({ date: today, morning: 70, steps: 21000, kcal: 220, proteinG: 8 });
    expect(last.avg7).toBe(70.2);
    const squat = p.strength.find((s) => s.slug === 'barbell-back-squat')!;
    expect(squat.points.at(-1)).toEqual({ date: today, e1rm: 120 });
    expect(p.records[0]).toMatchObject({ slug: 'barbell-back-squat', reps: 5 });
  });
});

describe('недельный разбор', () => {
  it('решения: пропуски и плохой сон — объём вниз; всё сделано и рост — вверх', () => {
    const base = {
      weightChangeKg: 0.2,
      weightChangePct: 0.3,
      avgSteps: 15000,
      stepsDays: 7,
      avgKcal: 2500,
      avgNormKcal: 3000,
      avgProteinG: 100,
      proteinNormG: 140,
      foodDays: 5,
      sessionsPlanned: 3,
      sessionsDone: 3,
      sessionsMissed: 0,
      avgSleepHours: 8,
      avgWellbeing: 4,
      strength: [{ name: 'Присед', fromKg: 120, toKg: 126 }],
    };
    const up = decide(base, 0, 'В коридоре.');
    expect(up.volume).toBe('up');
    expect(up.points.join(' ')).toMatch(/Недоедаешь/);
    expect(up.points.join(' ')).toMatch(/Мало — мышцам/);
    expect(decide({ ...base, sessionsDone: 1, sessionsMissed: 2 }, 0, '').volume).toBe('down');
    expect(decide({ ...base, avgSleepHours: 6 }, 0, '').volumeText).toMatch(/сон/);
    expect(decide({ ...base, strength: [] }, 0, '').volume).toBe('keep');
  });

  it('по правилам без ИИ, с ИИ — текст тренера; сохраняется и читается', async () => {
    const { auth, call } = await person();
    expect((await call().get('/api/v1/ai/weekly-review').set(auth).expect(200)).body).toEqual({
      review: null,
    });
    const res = await call().post('/api/v1/ai/weekly-review').set(auth).expect(201);
    const review = res.body.review as WeeklyReview;
    expect(review).toMatchObject({
      source: 'rules',
      weekEnd: today,
      weekStart: addDays(today, -6),
      kcalDelta: 0,
      volume: 'keep',
    });
    expect(review.points.join(' ')).toMatch(/Еда не записана/);

    const ai: AiProvider = {
      enabled: true,
      model: 'fake',
      generateJson: <T>(req: Parameters<AiProvider['generateJson']>[0]) => {
        const r = req.validate({
          text: 'Неделя слабая: еды не видно, тренировок нет. Записывай всё.',
        });
        return r.ok
          ? Promise.resolve({ value: r.value as T, model: 'fake', tokens: 50 })
          : Promise.reject(new AiError('bad_response', 'x'));
      },
    };
    const app = createApp({ authMode: 'password', ai });
    const withAi = await request(app).post('/api/v1/ai/weekly-review').set(auth).expect(201);
    expect(withAi.body.review).toMatchObject({
      source: 'ai',
      text: 'Неделя слабая: еды не видно, тренировок нет. Записывай всё.',
    });
    const latest = (await call().get('/api/v1/ai/weekly-review').set(auth).expect(200)).body
      .review as WeeklyReview;
    expect(latest.id).toBe(withAi.body.review.id);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM ai_reports WHERE kind = 'weekly'",
    );
    expect(rows[0].n).toBe(2);
  });
});
