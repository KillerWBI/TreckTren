import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type {
  AthleteCard,
  PlanResponse,
  SessionExerciseView,
  WorkoutResponse,
  WorkoutSetView,
} from '@trektren/shared';
import { disabledAi } from '../src/ai/client.js';
import { createApp } from '../src/app.js';
import { addDays, mondayOf, todayIn } from '../src/dates.js';
import { pool } from '../src/db.js';
import { loadExercises } from '../src/modules/exercises/repo.js';
import { analyzeWorkout } from '../src/modules/workouts/analysis.js';
import { bearer, registerUser } from './helpers.js';

const app = createApp({ authMode: 'password', ai: disabledAi });
const nextMonday = addDays(mondayOf(todayIn('Europe/Warsaw')), 7);
const MWF = [0, 2, 4, 7, 9, 11].map((d) => addDays(nextMonday, d));

const set = (
  exerciseSlug: string,
  setNo: number,
  weightKg: number,
  reps: number,
  rir: number,
): WorkoutSetView => ({
  exerciseSlug,
  setNo,
  weightKg,
  reps,
  rir,
  est1rm: Math.round(weightKg * (1 + (reps + rir) / 30) * 10) / 10,
});

const planned = (slug: string, over: Partial<SessionExerciseView> = {}): SessionExerciseView => ({
  slug,
  name: slug,
  sets: 3,
  repsMin: 4,
  repsMax: 6,
  rir: 2,
  loadFactor: 1,
  load: { kind: 'kg', kg: 80, oneRmKg: 100, basis: 'own', perHand: false },
  ...over,
});

async function analyze(input: Partial<Parameters<typeof analyzeWorkout>[0]>) {
  const all = await loadExercises();
  return analyzeWorkout({
    planned: [],
    sets: [],
    exercises: new Map(all.map((e) => [e.slug, e])),
    maxes: new Map(),
    previous: new Map(),
    bestEver: new Map(),
    readiness: null,
    ...input,
  });
}

describe('разбор тренировки', () => {
  const own = (oneRmKg: number) => ({ oneRmKg, basis: 'own' as const });

  it('сильнее плана — максимум растёт, но не больше +5% за раз', async () => {
    const r = await analyze({
      planned: [planned('bench-press')],
      sets: [
        set('bench-press', 1, 100, 5, 2),
        set('bench-press', 2, 100, 5, 1),
        set('bench-press', 3, 100, 4, 1),
      ],
      maxes: new Map([['bench-press', own(100)]]),
    });
    expect(r.exercises[0]).toMatchObject({
      verdict: 'progress',
      maxBefore: 100,
      maxAfter: 105,
      bestE1rm: 123.3,
      doneSets: 3,
    });
    expect(r.exercises[0]!.text).toMatch(/не больше \+5%/);
    expect(r.maxChanges).toEqual([
      { slug: 'bench-press', oneRmKg: 105, working: { weightKg: 100, reps: 5, rir: 2 } },
    ]);
    expect(r.hard).toBe(false);
  });

  it('все подходы на верх диапазона с запасом — веса вверх на 2,5%', async () => {
    const r = await analyze({
      planned: [planned('bench-press')],
      sets: [1, 2, 3].map((n) => set('bench-press', n, 80, 6, 2)),
      maxes: new Map([['bench-press', own(100)]]),
    });
    expect(r.exercises[0]).toMatchObject({ verdict: 'progress', maxAfter: 102.5 });
    expect(r.maxChanges[0]!.oneRmKg).toBe(102.5);
  });

  it('по плану — максимум не трогаем; запас 0 при плане 2 — замечание', async () => {
    const r = await analyze({
      planned: [planned('bench-press')],
      sets: [set('bench-press', 1, 80, 5, 2), set('bench-press', 2, 80, 6, 0)],
      maxes: new Map([['bench-press', own(100)]]),
    });
    expect(r.exercises[0]!.verdict).toBe('hold');
    expect(r.exercises[0]!.text).toMatch(/Сделал 2 из 3/);
    expect(r.exercises[0]!.text).toMatch(/до отказа рано/);
    expect(r.maxChanges).toEqual([]);
  });

  it('тяжело один раз — ждём; второй раз подряд — минус 5%; при плохом самочувствии не снижаем', async () => {
    const heavy = {
      planned: [planned('bench-press')],
      sets: [set('bench-press', 1, 70, 4, 0)],
      maxes: new Map([['bench-press', own(100)]]),
    };
    const first = await analyze(heavy);
    expect(first.exercises[0]!.verdict).toBe('heavy');
    expect(first.hard).toBe(true);
    expect(first.maxChanges).toEqual([]);

    const second = await analyze({
      ...heavy,
      previous: new Map([['bench-press', 'heavy' as const]]),
    });
    expect(second.exercises[0]).toMatchObject({ verdict: 'under', maxAfter: 95 });
    expect(second.maxChanges[0]!.oneRmKg).toBe(95);

    const tired = await analyze({
      ...heavy,
      previous: new Map([['bench-press', 'heavy' as const]]),
      readiness: 2,
    });
    expect(tired.exercises[0]!.verdict).toBe('heavy');
    expect(tired.exercises[0]!.text).toMatch(/Самочувствие/);
  });

  it('первая запись упражнения задаёт его максимум; пропуск и свой вес', async () => {
    const r = await analyze({
      planned: [planned('lat-pulldown'), planned('pull-up'), planned('leg-extension')],
      sets: [
        set('lat-pulldown', 1, 60, 10, 2),
        set('pull-up', 1, 0, 8, 1),
        set('pull-up', 2, 0, 7, 1),
      ],
      maxes: new Map([['lat-pulldown', { oneRmKg: 70, basis: 'ratio' as const }]]),
    });
    expect(r.exercises.map((e) => e.verdict)).toEqual(['first', 'hold', 'skipped']);
    expect(r.exercises[0]!.maxAfter).toBe(84);
    expect(r.exercises[1]!.text).toMatch(/Повторы: 8, 7/);
    expect(r.summary).toMatch(/Пропущено: leg-extension|Пропущено: разгибание ног/i);
    expect(r.maxChanges.map((c) => c.slug)).toEqual(['lat-pulldown']);
  });

  it('рекорд — если лучше всего, что было', async () => {
    const r = await analyze({
      planned: [planned('bench-press')],
      sets: [set('bench-press', 1, 90, 3, 1)],
      maxes: new Map([['bench-press', own(100)]]),
      bestEver: new Map([['bench-press', 100]]),
    });
    expect(r.exercises[0]!.record).toBe(true);
    expect(r.records).toHaveLength(1);
  });
});

describe('тренировка: API', () => {
  async function athleteWithPlan() {
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    const card: AthleteCard = {
      goals: { primary: 'strength' },
      basics: { sex: 'male', heightCm: 180, weightKg: 80 },
      availability: { sessionsPerWeek: 3, sessionMinutes: 90 },
    };
    await request(app).patch('/api/v1/card').set(auth).send({ patch: card }).expect(200);
    await request(app)
      .put('/api/v1/strength')
      .set(auth)
      .send({
        lifts: [
          { slug: 'barbell-back-squat', testedKg: 120 },
          { slug: 'bench-press', testedKg: 100 },
          { slug: 'deadlift', testedKg: 170 },
        ],
      })
      .expect(200);
    const plan = (
      await request(app).post('/api/v1/plan/generate').set(auth).send({ dates: MWF }).expect(200)
    ).body as PlanResponse;
    return { user, auth, plan };
  }

  it('начать → подходы → завершить: разбор, новые максимумы, веса следующих тренировок', async () => {
    const { auth, plan } = await athleteWithPlan();
    const session = plan.sessions[0]!;
    expect(session.workout).toBeNull();

    const start = await request(app)
      .post('/api/v1/workouts')
      .set(auth)
      .send({ sessionId: session.id, readiness: 4 })
      .expect(201);
    const w = start.body as WorkoutResponse;
    expect(w.workout).toMatchObject({
      sessionId: session.id,
      readiness: 4,
      finishedAt: null,
      sets: [],
    });
    expect(w.session!.exercises[0]!.slug).toBe('barbell-back-squat');
    // Повторный старт — та же тренировка.
    const again = await request(app)
      .post('/api/v1/workouts')
      .set(auth)
      .send({ sessionId: session.id })
      .expect(201);
    expect(again.body.workout.id).toBe(w.workout.id);

    const id = w.workout.id;
    const squatKg = (w.session!.exercises[0]!.load as { kg: number }).kg;
    for (const n of [1, 2, 3, 4]) {
      await request(app)
        .put(`/api/v1/workouts/${id}/sets`)
        .set(auth)
        .send({
          exerciseSlug: 'barbell-back-squat',
          setNo: n,
          weightKg: squatKg + 10,
          reps: 6,
          rir: 2,
        })
        .expect(200);
    }
    // Поправка подхода — тот же номер перезаписывается.
    await request(app)
      .put(`/api/v1/workouts/${id}/sets`)
      .set(auth)
      .send({
        exerciseSlug: 'barbell-back-squat',
        setNo: 4,
        weightKg: squatKg + 10,
        reps: 5,
        rir: 2,
      })
      .expect(200);
    const stack = w.session!.exercises.find((x) => x.load.kind === 'calibrate')!;
    await request(app)
      .put(`/api/v1/workouts/${id}/sets`)
      .set(auth)
      .send({ exerciseSlug: stack.slug, setNo: 1, weightKg: 50, reps: 12, rir: 2 })
      .expect(200);
    await request(app).delete(`/api/v1/workouts/${id}/sets/${stack.slug}/2`).set(auth).expect(204);

    const done = (
      await request(app)
        .post(`/api/v1/workouts/${id}/finish`)
        .set(auth)
        .send({ notes: 'Норм' })
        .expect(200)
    ).body as WorkoutResponse;
    expect(done.workout.finishedAt).not.toBeNull();
    expect(done.workout.sets.filter((s) => s.exerciseSlug === 'barbell-back-squat')).toHaveLength(
      4,
    );
    const squat = done.workout.analysis!.exercises.find((e) => e.slug === 'barbell-back-squat')!;
    expect(squat).toMatchObject({ verdict: 'progress', maxBefore: 120, maxAfter: 126 });
    expect(done.workout.analysis!.exercises.find((e) => e.slug === stack.slug)!.verdict).toBe(
      'first',
    );
    expect(done.workout.analysis!.nextChanges.join(' ')).toMatch(/120 → 126/);

    const card = (await request(app).get('/api/v1/card').set(auth).expect(200)).body
      .card as AthleteCard;
    expect(card.strength!.lifts!['barbell-back-squat']).toMatchObject({
      oneRmKg: 126,
      testedKg: 120,
      source: 'log',
    });
    expect(card.strength!.lifts![stack.slug]).toMatchObject({ oneRmKg: 73.3, source: 'log' });

    const after = (await request(app).get('/api/v1/plan').set(auth).expect(200))
      .body as PlanResponse;
    expect(after.sessions[0]).toMatchObject({ status: 'done', workout: { id, finished: true } });
    const nextSquat = after.sessions
      .slice(1)
      .flatMap((s) => s.exercises)
      .find((x) => x.slug === 'barbell-back-squat')!;
    expect(nextSquat.load).toMatchObject({ oneRmKg: 126 });
    const nextStack = after.sessions
      .slice(1)
      .flatMap((s) => s.exercises)
      .find((x) => x.slug === stack.slug);
    if (nextStack) expect(nextStack.load).toMatchObject({ kind: 'kg', basis: 'own' });

    // После завершения подходы не меняются.
    await request(app)
      .put(`/api/v1/workouts/${id}/sets`)
      .set(auth)
      .send({ exerciseSlug: 'barbell-back-squat', setNo: 5, weightKg: 100, reps: 5, rir: 2 })
      .expect(409);
    await request(app).post(`/api/v1/workouts/${id}/finish`).set(auth).send({}).expect(409);
  });

  it('тяжёлая тренировка облегчает следующую', async () => {
    const { auth, plan } = await athleteWithPlan();
    const start = await request(app)
      .post('/api/v1/workouts')
      .set(auth)
      .send({ sessionId: plan.sessions[0]!.id, readiness: 2 })
      .expect(201);
    const id = start.body.workout.id;
    await request(app)
      .put(`/api/v1/workouts/${id}/sets`)
      .set(auth)
      .send({ exerciseSlug: 'barbell-back-squat', setNo: 1, weightKg: 80, reps: 3, rir: 0 })
      .expect(200);
    const done = await request(app)
      .post(`/api/v1/workouts/${id}/finish`)
      .set(auth)
      .send({})
      .expect(200);
    expect(done.body.workout.analysis.nextChanges.join(' ')).toMatch(/облегчена/);
    const after = (await request(app).get('/api/v1/plan').set(auth).expect(200))
      .body as PlanResponse;
    const next = after.sessions[1]!;
    expect(next.adjustments.join(' ')).toMatch(/далась тяжело/);
    expect(next.exercises[0]!.loadFactor).toBe(0.95);
    expect(next.exercises[0]!.rir).toBe(plan.sessions[1]!.exercises[0]!.rir + 1);
  });

  it('пустую не завершить, чужую не открыть, пропущенные видно в плане', async () => {
    const { user, auth, plan } = await athleteWithPlan();
    const start = await request(app)
      .post('/api/v1/workouts')
      .set(auth)
      .send({ sessionId: plan.sessions[0]!.id })
      .expect(201);
    await request(app)
      .post(`/api/v1/workouts/${start.body.workout.id}/finish`)
      .set(auth)
      .send({})
      .expect(400);

    const other = await registerUser();
    await request(app)
      .get(`/api/v1/workouts/${start.body.workout.id}`)
      .set(bearer(other.accessToken))
      .expect(404);
    await request(app)
      .post('/api/v1/workouts')
      .set(bearer(other.accessToken))
      .send({ sessionId: plan.sessions[1]!.id })
      .expect(404);
    await request(app).get('/api/v1/workouts/not-a-uuid').set(auth).expect(404);

    // Вторая тренировка «в прошлом» и не сделана — пропущена.
    await pool.query('UPDATE scheduled_sessions SET date = $2 WHERE id = $1', [
      plan.sessions[1]!.id,
      addDays(todayIn('Europe/Warsaw'), -1),
    ]);
    const after = (await request(app).get('/api/v1/plan').set(auth).expect(200))
      .body as PlanResponse;
    expect(after.sessions.find((s) => s.id === plan.sessions[1]!.id)!.status).toBe('missed');
    expect(after.block!.missed).toBe(1);
    expect(user.userId).toBeTruthy();
  });

  it('смена дней и перестройка не удаляют начатую тренировку', async () => {
    const { auth, plan } = await athleteWithPlan();
    const first = plan.sessions[0]!;
    await request(app).post('/api/v1/workouts').set(auth).send({ sessionId: first.id }).expect(201);
    const res = await request(app)
      .put('/api/v1/plan/schedule')
      .set(auth)
      .send({ dates: MWF.slice(1) })
      .expect(200);
    const sessions = (res.body as PlanResponse).sessions;
    expect(sessions.filter((s) => s.date === first.date)).toHaveLength(1);
    expect(sessions.find((s) => s.date === first.date)!.workout).not.toBeNull();
  });
});
