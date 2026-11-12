import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AthleteCard, BlockTemplate, PlanResponse } from '@trektren/shared';
import { AiError, disabledAi, type AiProvider, type JsonRequest } from '../src/ai/client.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { addDays, mondayOf, todayIn } from '../src/dates.js';
import { pool } from '../src/db.js';
import { bearer, registerUser } from './helpers.js';

const rulesApp = createApp({ authMode: 'password', ai: disabledAi });

// Дни в будущем: понедельник через неделю, пн/ср/пт две недели.
const nextMonday = addDays(mondayOf(todayIn('Europe/Warsaw')), 7);
const days = (offsets: number[]) => offsets.map((d) => addDays(nextMonday, d));
const MWF = days([0, 2, 4, 7, 9, 11]);

const fullCard: AthleteCard = {
  goals: { primary: 'strength_hypertrophy', priorityMuscles: ['chest'] },
  basics: { sex: 'male', heightCm: 180, weightKg: 82 },
  availability: { sessionsPerWeek: 3, sessionMinutes: 75 },
  equipment: { location: 'gym' },
};

async function athlete(app = rulesApp, card: AthleteCard = fullCard) {
  const user = await registerUser();
  const auth = bearer(user.accessToken);
  await request(app).patch('/api/v1/card').set(auth).send({ patch: card }).expect(200);
  return { user, auth, call: () => request(app) };
}

/** Провайдер-заглушка: отвечает заданным шаблоном и запоминает запросы. */
function fakeAi(template: (req: JsonRequest<unknown>) => unknown) {
  const requests: Array<JsonRequest<unknown>> = [];
  const ai: AiProvider = {
    enabled: true,
    model: 'fake-model',
    generateJson<T>(req: JsonRequest<T>) {
      requests.push(req as JsonRequest<unknown>);
      const checked = req.validate(template(req as JsonRequest<unknown>));
      if (!checked.ok)
        return Promise.reject(new AiError('bad_response', checked.errors.join('; ')));
      return Promise.resolve({ value: checked.value, model: 'fake-model-001', tokens: 1234 });
    },
  };
  return { ai, requests };
}

const aiTemplate: BlockTemplate = {
  split: 'Верх/низ от ИИ',
  accumulationWeeks: 3,
  weeks: [
    { rir: 2, extraSets: 0 },
    { rir: 2, extraSets: 1 },
    { rir: 1, extraSets: 1 },
  ],
  sessions: [
    {
      key: 'A',
      title: 'Жим и тяга',
      exercises: [
        { slug: 'bench-press', sets: 4, repsMin: 4, repsMax: 6 },
        { slug: 'barbell-row', sets: 4, repsMin: 6, repsMax: 8 },
      ],
    },
    {
      key: 'B',
      title: 'Ноги',
      exercises: [
        { slug: 'barbell-back-squat', sets: 4, repsMin: 4, repsMax: 6 },
        { slug: 'romanian-deadlift', sets: 3, repsMin: 6, repsMax: 8 },
      ],
    },
  ],
  rotation: ['A', 'B'],
  rationale: 'Два шаблона под три дня.',
  coachNote: 'Без пропусков.',
};

describe('план: по правилам', () => {
  it('без плана — пусто, ИИ не подключён', async () => {
    const { auth, call } = await athlete();
    const res = await call().get('/api/v1/plan').set(auth).expect(200);
    expect(res.body).toEqual({ block: null, sessions: [], ai: { enabled: false, model: null } });
  });

  it('пустая карточка — 422 со списком разделов', async () => {
    const user = await registerUser();
    const res = await request(rulesApp)
      .post('/api/v1/plan/generate')
      .set(bearer(user.accessToken))
      .send({ dates: MWF })
      .expect(422);
    expect(res.body.error.code).toBe('CARD_INCOMPLETE');
    expect(res.body.error.details.sections).toEqual(['goals', 'basics', 'availability']);
  });

  it('прошедшие и слишком далёкие дни — 400', async () => {
    const { auth, call } = await athlete();
    const past = addDays(todayIn('Europe/Warsaw'), -1);
    await call()
      .post('/api/v1/plan/generate')
      .set(auth)
      .send({ dates: [past] })
      .expect(400);
    await call()
      .post('/api/v1/plan/generate')
      .set(auth)
      .send({ dates: [addDays(nextMonday, 70)] })
      .expect(400);
    await call().post('/api/v1/plan/generate').set(auth).send({ dates: [] }).expect(400);
  });

  it('строит блок на выбранные дни, без максимумов — подбор веса', async () => {
    const { auth, call } = await athlete();
    const res = await call()
      .post('/api/v1/plan/generate')
      .set(auth)
      .send({ dates: [...MWF].reverse(), comment: 'Хочу больше спины' })
      .expect(200);
    const plan = res.body as PlanResponse;
    expect(plan.block).toMatchObject({
      source: 'rules',
      model: null,
      split: 'Фулбади A/B/C',
      startDate: MWF[0],
      comment: 'Хочу больше спины',
    });
    expect(plan.block!.generationNote).toMatch(/ИИ/);
    expect(plan.sessions.map((s) => s.date)).toEqual(MWF);
    expect(plan.sessions.map((s) => s.templateKey)).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    const loads = plan.sessions.flatMap((s) => s.exercises.map((x) => x.load.kind));
    expect(loads.every((k) => k === 'calibrate' || k === 'bodyweight')).toBe(true);
    expect(loads).toContain('calibrate');
    expect(plan.sessions[0]!.exercises[0]!.name).toMatch(/[а-я]/i);
  });

  it('стартовые веса пишутся в карточку и дают килограммы в плане', async () => {
    const { auth, call } = await athlete();
    await call().post('/api/v1/plan/generate').set(auth).send({ dates: MWF }).expect(200);

    const res = await call()
      .post('/api/v1/strength/baseline')
      .set(auth)
      .send({
        lifts: [
          { slug: 'bench-press', weightKg: 80, reps: 5 },
          { slug: 'barbell-back-squat', weightKg: 120, reps: 1 },
        ],
      })
      .expect(200);
    expect(res.body.card.strength.lifts['bench-press']).toMatchObject({
      oneRmKg: 93.3,
      estimated: true,
    });
    expect(res.body.card.strength.lifts['barbell-back-squat']).toMatchObject({
      oneRmKg: 120,
      estimated: false,
    });

    const plan = (await call().get('/api/v1/plan').set(auth).expect(200)).body as PlanResponse;
    const bench = plan.sessions.flatMap((s) => s.exercises).find((x) => x.slug === 'bench-press')!;
    expect(bench.load).toMatchObject({ kind: 'kg', oneRmKg: 93.3 });
    if (bench.load.kind === 'kg') expect(bench.load.kg % 2.5).toBe(0);

    await call()
      .post('/api/v1/strength/baseline')
      .set(auth)
      .send({ lifts: [{ slug: 'push-up', weightKg: 10, reps: 5 }] })
      .expect(400);
  });

  it('смена дней перекладывает тот же блок', async () => {
    const { auth, call } = await athlete();
    const first = (
      await call().post('/api/v1/plan/generate').set(auth).send({ dates: MWF }).expect(200)
    ).body as PlanResponse;
    const newDates = days([1, 3, 5, 8, 10]);
    const res = await call()
      .put('/api/v1/plan/schedule')
      .set(auth)
      .send({ dates: newDates })
      .expect(200);
    const plan = res.body as PlanResponse;
    expect(plan.block!.id).toBe(first.block!.id);
    expect(plan.sessions.map((s) => s.date)).toEqual(newDates);
  });

  it('смена дней без плана — 404', async () => {
    const { auth, call } = await athlete();
    await call().put('/api/v1/plan/schedule').set(auth).send({ dates: MWF }).expect(404);
  });

  it('перестройка закрывает старый блок', async () => {
    const { user, auth, call } = await athlete();
    await call().post('/api/v1/plan/generate').set(auth).send({ dates: MWF }).expect(200);
    const res = await call()
      .post('/api/v1/plan/generate')
      .set(auth)
      .send({ dates: days([0, 3]) })
      .expect(200);
    expect(res.body.sessions).toHaveLength(2);
    const { rows } = await pool.query<{ status: string; n: string }>(
      'SELECT status, count(*) AS n FROM training_blocks WHERE user_id = $1 GROUP BY status ORDER BY status',
      [user.userId],
    );
    expect(rows).toEqual([
      { status: 'active', n: 1 },
      { status: 'closed', n: 1 },
    ]);
  });

  it('план доступен только своему пользователю', async () => {
    const { auth, call } = await athlete();
    await call().post('/api/v1/plan/generate').set(auth).send({ dates: MWF }).expect(200);
    const other = await registerUser();
    const res = await call().get('/api/v1/plan').set(bearer(other.accessToken)).expect(200);
    expect(res.body.block).toBeNull();
    await call().get('/api/v1/plan').expect(401);
  });

  it('база упражнений отдаётся клиенту', async () => {
    const { auth, call } = await athlete();
    const res = await call().get('/api/v1/exercises').set(auth).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(60);
    expect(res.body[0]).not.toHaveProperty('contraindications');
  });
});

describe('план: ИИ', () => {
  it('строит по шаблону от ИИ и считает запросы', async () => {
    const { ai, requests } = fakeAi(() => aiTemplate);
    const app = createApp({ authMode: 'password', ai });
    const { user, auth, call } = await athlete(app);
    const res = await call()
      .post('/api/v1/plan/generate')
      .set(auth)
      .send({ dates: MWF, comment: 'Жим в приоритете' })
      .expect(200);
    const plan = res.body as PlanResponse;
    expect(plan.ai).toEqual({ enabled: true, model: 'fake-model' });
    expect(plan.block).toMatchObject({
      source: 'ai',
      model: 'fake-model-001',
      split: 'Верх/низ от ИИ',
      generationNote: null,
    });
    expect(plan.sessions.map((s) => s.templateKey)).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);

    const prompt = requests[0]!.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('Жим в приоритете');
    expect(prompt).toContain(MWF[0]);
    expect(prompt).toContain('bench-press');

    const { rows } = await pool.query('SELECT requests, tokens FROM ai_usage WHERE user_id = $1', [
      user.userId,
    ]);
    expect(rows).toEqual([{ requests: 1, tokens: 1234 }]);
  });

  it('ИИ не ответил — план по правилам с пояснением', async () => {
    const ai: AiProvider = {
      enabled: true,
      model: 'fake-model',
      generateJson: () => Promise.reject(new AiError('timeout', 'ИИ не ответил вовремя')),
    };
    const { auth, call } = await athlete(createApp({ authMode: 'password', ai }));
    const res = await call()
      .post('/api/v1/plan/generate')
      .set(auth)
      .send({ dates: MWF })
      .expect(200);
    expect(res.body.block.source).toBe('rules');
    expect(res.body.block.generationNote).toMatch(/ИИ не ответил/);
    expect(res.body.sessions).toHaveLength(6);
  });

  it('дневной лимит построений — 429', async () => {
    const { ai } = fakeAi(() => aiTemplate);
    const { user, auth, call } = await athlete(createApp({ authMode: 'password', ai }));
    await pool.query(
      `INSERT INTO ai_usage (user_id, date, kind, requests) VALUES ($1, $2, 'plan', $3)`,
      [user.userId, todayIn('Europe/Warsaw'), config.AI_DAILY_LIMIT],
    );
    const res = await call()
      .post('/api/v1/plan/generate')
      .set(auth)
      .send({ dates: MWF })
      .expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
