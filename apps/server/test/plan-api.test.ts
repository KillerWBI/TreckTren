import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type {
  AthleteCard,
  BlockTemplate,
  DiagnosticsResponse,
  PlanResponse,
} from '@trektren/shared';
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
      split: 'Присед / жим / становая',
      startDate: MWF[0],
      comment: 'Хочу больше спины',
    });
    expect(plan.block!.generationNote).toMatch(/ИИ/);
    expect(plan.sessions.map((s) => s.date)).toEqual(MWF);
    expect(plan.sessions.map((s) => s.templateKey)).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    // Силовых данных нет — веса по весу тела и стажу, блоки — подбор на месте.
    const loads = plan.sessions.flatMap((s) => s.exercises.map((x) => x.load));
    expect(loads.find((l) => l.kind === 'kg')).toMatchObject({ basis: 'bodyweight' });
    for (const l of loads) {
      if (l.kind === 'calibrate') expect(l.reason).toBe('stack');
    }
    expect(plan.sessions[0]!.exercises[0]!.name).toMatch(/[а-я]/i);
  });

  it('силовые: реальный максимум и рабочий подход, веса в плане от них', async () => {
    const { auth, call } = await athlete();
    await call().post('/api/v1/plan/generate').set(auth).send({ dates: MWF }).expect(200);

    const res = await call()
      .put('/api/v1/strength')
      .set(auth)
      .send({
        lifts: [
          { slug: 'bench-press', testedKg: 100, working: { weightKg: 80, reps: 10, rir: 0 } },
          { slug: 'barbell-back-squat', working: { weightKg: 100, reps: 5, rir: 1 } },
        ],
        targets: { 'bench-press': 120 },
      })
      .expect(200);
    const lifts = res.body.card.strength.lifts;
    expect(lifts['bench-press']).toMatchObject({
      oneRmKg: 100,
      estimated: false,
      testedKg: 100,
      source: 'user',
    });
    expect(lifts['barbell-back-squat']).toMatchObject({ oneRmKg: 120, estimated: true });
    expect(res.body.card.strength.targets).toEqual({ 'bench-press': 120 });

    const plan = (await call().get('/api/v1/plan').set(auth).expect(200)).body as PlanResponse;
    const all = plan.sessions.flatMap((s) => s.exercises);
    expect(all.find((x) => x.slug === 'bench-press')!.load).toMatchObject({
      kind: 'kg',
      basis: 'own',
      oneRmKg: 100,
    });
    // Становой нет — от приседа; гантели на наклонной — от жима.
    expect(all.find((x) => x.slug === 'deadlift')!.load).toMatchObject({
      basis: 'ratio',
      fromSlug: 'barbell-back-squat',
    });
    expect(plan.block!.staleSections).toEqual([]);

    // Удаление: null убирает максимум, остаётся расчёт по подходу.
    const removed = await call()
      .put('/api/v1/strength')
      .set(auth)
      .send({ lifts: [{ slug: 'bench-press', testedKg: null }] })
      .expect(200);
    expect(removed.body.card.strength.lifts['bench-press']).toMatchObject({
      oneRmKg: 106.7,
      estimated: true,
    });
    expect(removed.body.card.strength.lifts['bench-press'].testedKg).toBeUndefined();

    await call()
      .put('/api/v1/strength')
      .set(auth)
      .send({ lifts: [{ slug: 'push-up', testedKg: 10 }] })
      .expect(400);
  });

  it('поменял карточку после плана — план просит перестроить', async () => {
    const { auth, call } = await athlete();
    await call().post('/api/v1/plan/generate').set(auth).send({ dates: MWF }).expect(200);
    await call()
      .patch('/api/v1/card')
      .set(auth)
      .send({ patch: { availability: { sessionMinutes: 60 } } })
      .expect(200);
    const plan = (await call().get('/api/v1/plan').set(auth).expect(200)).body as PlanResponse;
    expect(plan.block!.staleSections).toEqual(['availability']);
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

  it('цифры из текста анкеты и комментария ИИ записывает в «Силовые», своё не трогает', async () => {
    const { ai } = fakeAi(() => ({
      ...aiTemplate,
      fromText: {
        lifts: [
          { slug: 'barbell-back-squat', kind: 'max', weightKg: 120, reps: 1 },
          { slug: 'deadlift', kind: 'max', weightKg: 170 },
          { slug: 'bench-press', kind: 'max', weightKg: 999 },
          { slug: 'made-up', kind: 'max', weightKg: 50 },
        ],
        targets: [{ slug: 'barbell-back-squat', weightKg: 150 }],
      },
    }));
    const app = createApp({ authMode: 'password', ai });
    const { auth, call } = await athlete(app, {
      ...fullCard,
      goals: { ...fullCard.goals, notes: 'присед 120 на раз, становая 170' },
    });
    await call()
      .put('/api/v1/strength')
      .set(auth)
      .send({ lifts: [{ slug: 'bench-press', testedKg: 100 }] })
      .expect(200);

    const res = await call()
      .post('/api/v1/plan/generate')
      .set(auth)
      .send({ dates: MWF })
      .expect(200);
    expect(res.body.block.factsNote).toMatch(/присед со штангой — максимум 120 кг/);
    expect(res.body.block.factsNote).toMatch(/цель: присед со штангой 150 кг/);

    const card = (await call().get('/api/v1/card').set(auth).expect(200)).body.card as AthleteCard;
    expect(card.strength!.lifts!['barbell-back-squat']).toMatchObject({
      oneRmKg: 120,
      testedKg: 120,
      source: 'text',
    });
    expect(card.strength!.lifts!.deadlift).toMatchObject({ oneRmKg: 170 });
    expect(card.strength!.lifts!['bench-press']).toMatchObject({ oneRmKg: 100, source: 'user' });
    expect(card.strength!.targets).toEqual({ 'barbell-back-squat': 150 });
    // Запись ИИ не делает план «устаревшим».
    expect(res.body.block.staleSections).toEqual([]);
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

describe('прогноз, проходка и диагностика', () => {
  // 5 недель пн/ср/пт: 4 недели накопления, на 5-й — разгрузка, её пятница — проходка.
  const fiveWeeks = days([0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25, 28, 30, 32]);

  async function strongAthlete() {
    const ctx = await athlete(rulesApp, {
      ...fullCard,
      goals: { primary: 'strength' },
      experience: { trainingYears: 1.5 },
    });
    await ctx
      .call()
      .put('/api/v1/strength')
      .set(ctx.auth)
      .send({
        lifts: [
          { slug: 'barbell-back-squat', testedKg: 120 },
          { slug: 'deadlift', testedKg: 170 },
          { slug: 'bench-press', testedKg: 100 },
        ],
        targets: { 'barbell-back-squat': 150 },
      })
      .expect(200);
    return ctx;
  }

  it('прогноз на конец блока и проходка после разгрузки', async () => {
    const { auth, call } = await strongAthlete();
    const plan = (
      await call().post('/api/v1/plan/generate').set(auth).send({ dates: fiveWeeks }).expect(200)
    ).body as PlanResponse;

    const forecast = plan.block!.forecast;
    expect(forecast.map((f) => f.slug)).toEqual(['barbell-back-squat', 'bench-press', 'deadlift']);
    const squat = forecast[0]!;
    expect(squat.startKg).toBe(120);
    expect(squat.targetKg).toBeGreaterThan(120);
    expect(squat.targetKg % 2.5).toBe(0);
    expect(squat.goalKg).toBe(150);
    expect(squat.blocksToGoal).toBeGreaterThan(1);
    // Присед отстаёт от становой — прогноз по нему выше в процентах.
    const pct = (f: (typeof forecast)[number]) => f.targetKg / f.startKg;
    expect(pct(squat)).toBeGreaterThanOrEqual(pct(forecast[1]!));

    const test = plan.sessions.find((s) => s.phase === 'test')!;
    expect(test.date).toBe(fiveWeeks[fiveWeeks.length - 1]);
    expect(plan.block!.testDate).toBe(test.date);
    expect(test.exercises[0]).toMatchObject({
      slug: 'barbell-back-squat',
      sets: 1,
      load: { kind: 'kg', kg: squat.targetKg, basis: 'target' },
    });
    expect(test.exercises[0]!.note).toMatch(/Подводка/);
    expect(plan.sessions.filter((s) => s.phase === 'deload')).toHaveLength(2);
  });

  it('дни не доходят до разгрузки — проходки нет, видно, с какой даты отмечать', async () => {
    const { auth, call } = await strongAthlete();
    const plan = (
      await call().post('/api/v1/plan/generate').set(auth).send({ dates: MWF }).expect(200)
    ).body as PlanResponse;
    expect(plan.block!.testDate).toBeNull();
    expect(plan.block!.testFrom).toBe(addDays(nextMonday, 28));
    expect(plan.block!.forecast.length).toBeGreaterThan(0);
  });

  it('результат проходки: сверка с прогнозом и новые максимумы в карточке', async () => {
    const { user, auth, call } = await strongAthlete();
    const plan = (
      await call().post('/api/v1/plan/generate').set(auth).send({ dates: fiveWeeks }).expect(200)
    ).body as PlanResponse;
    const test = plan.sessions.find((s) => s.phase === 'test')!;
    const [squat, bench, dl] = plan.block!.forecast;

    // Будущую проходку записать нельзя.
    await call()
      .post(`/api/v1/plan/sessions/${test.id}/result`)
      .set(auth)
      .send({ lifts: [{ slug: 'barbell-back-squat', weightKg: 130, reps: 1 }] })
      .expect(400);
    await pool.query('UPDATE scheduled_sessions SET date = $2 WHERE id = $1', [
      test.id,
      todayIn('Europe/Warsaw'),
    ]);

    const res = await call()
      .post(`/api/v1/plan/sessions/${test.id}/result`)
      .set(auth)
      .send({
        lifts: [
          { slug: 'barbell-back-squat', weightKg: squat!.targetKg + 2.5, reps: 1 },
          { slug: 'bench-press', weightKg: bench!.targetKg - 2.5, reps: 1 },
          { slug: 'deadlift', weightKg: 150, reps: 3 },
        ],
      })
      .expect(200);
    const done = (res.body as PlanResponse).sessions.find((s) => s.id === test.id)!;
    expect(done.status).toBe('done');
    expect(done.result!.lifts.map((l) => l.verdict)).toEqual(['above', 'near', 'regress']);
    expect(done.result!.lifts[2]!.oneRmKg).toBe(165);
    expect(done.result!.summary).toMatch(/2 из 3/);
    expect(done.result!.summary).toMatch(/становая тяга/);

    const card = (await call().get('/api/v1/card').set(auth).expect(200)).body.card as AthleteCard;
    expect(card.strength!.lifts!['barbell-back-squat']).toMatchObject({
      testedKg: squat!.targetKg + 2.5,
      oneRmKg: squat!.targetKg + 2.5,
      source: 'test',
    });
    // Становая на 3 повтора — рабочий подход; реальный максимум 170 остаётся.
    expect(card.strength!.lifts!.deadlift).toMatchObject({
      testedKg: 170,
      working: { weightKg: 150, reps: 3 },
    });
    expect(dl).toBeDefined();
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM card_versions WHERE user_id = $1 AND reason = $2',
      [user.userId, 'Проходка'],
    );
    expect(rows[0].n).toBe(1);

    // Обычную тренировку как проходку не записать.
    const regular = plan.sessions.find((s) => s.phase === 'accumulation')!;
    await call()
      .post(`/api/v1/plan/sessions/${regular.id}/result`)
      .set(auth)
      .send({ lifts: [{ slug: 'barbell-back-squat', weightKg: 100, reps: 1 }] })
      .expect(400);
  });

  it('диагностика: находит отстающий присед, даёт тесты, пишет вывод в слабые места', async () => {
    const { auth, call } = await strongAthlete();
    await call().post('/api/v1/plan/generate').set(auth).send({ dates: MWF }).expect(200);

    const res = await call().get('/api/v1/diagnostics').set(auth).expect(200);
    const body = res.body as DiagnosticsResponse;
    expect(body.checks).toHaveLength(1);
    const check = body.checks[0]!;
    expect(check.finding).toMatchObject({
      id: 'squat-vs-deadlift',
      lagging: 'barbell-back-squat',
      ratio: 0.71,
    });
    expect(check.tests.map((t) => t.id)).toEqual(['front-squat', 'pause-squat', 'ankle']);
    expect(check.tests[1]!.howTo).toMatch(/^85 кг/);

    const after = await call()
      .post('/api/v1/diagnostics/squat-vs-deadlift')
      .set(auth)
      .send({ results: { 'front-squat': 80, 'pause-squat': 3, ankle: 12, unknown: 5 } })
      .expect(200);
    const last = (after.body as DiagnosticsResponse).checks[0]!.last!;
    expect(last.results).toEqual({ 'front-squat': 80, 'pause-squat': 3, ankle: 12 });
    expect(last.summary).toMatch(/квадрицепсы/);
    expect(last.summary).toMatch(/нижней точке/);
    expect(last.summary).not.toMatch(/Голеностоп/);

    const card = (await call().get('/api/v1/card').set(auth).expect(200)).body.card as AthleteCard;
    expect(card.weakPoints).toEqual([
      expect.objectContaining({
        id: 'diag-squat-vs-deadlift',
        area: 'Присед со штангой',
        status: 'confirmed',
        source: 'ai',
      }),
    ]);
    // Вывод диагностики — повод перестроить план.
    const plan = (await call().get('/api/v1/plan').set(auth).expect(200)).body as PlanResponse;
    expect(plan.block!.staleSections).toEqual(['weakPoints']);

    await call()
      .post('/api/v1/diagnostics/bench-vs-squat')
      .set(auth)
      .send({ results: { 'close-grip': 80 } })
      .expect(404);
    await call()
      .post('/api/v1/diagnostics/squat-vs-deadlift')
      .set(auth)
      .send({ results: { nope: 1 } })
      .expect(400);
  });

  it('без максимумов — диагностике нечего сравнивать', async () => {
    const { auth, call } = await athlete();
    const res = await call().get('/api/v1/diagnostics').set(auth).expect(200);
    expect(res.body).toEqual({ checks: [], note: expect.stringMatching(/хотя бы в двух/) });
  });
});
