import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AthleteCard, DayResponse, ParsedFood } from '@trektren/shared';
import { AiError, disabledAi, type AiProvider, type JsonRequest } from '../src/ai/client.js';
import { createApp } from '../src/app.js';
import { addDays, todayIn } from '../src/dates.js';
import { proteinSuggestions } from '../src/modules/day/foods.js';
import { computeNorm, computeTrend, type WeightRow } from '../src/modules/day/norm.js';
import { bearer, registerUser } from './helpers.js';

const artem: AthleteCard = {
  goals: { primary: 'strength_hypertrophy' },
  basics: { sex: 'male', heightCm: 178, weightKg: 70, birthDate: '2008-02-19' },
  availability: { sessionsPerWeek: 3, sessionMinutes: 100 },
  activity: { jobType: 'on_feet', avgSteps: 20000 },
  nutrition: { excludedFoods: ['мясное', 'сладкое'] },
};

describe('норма калорий', () => {
  it('Миффлин-Сан Жеор × 1,2 + шаги + тренировка + цель', () => {
    const { norm } = computeNorm({
      card: artem,
      date: '2026-11-13',
      weightKg: 70,
      steps: null,
      trainingMinutes: 100,
      adjust: 0,
    });
    expect(norm).toMatchObject({
      kcal: 3450,
      proteinG: 140,
      fatG: 63,
      carbsG: 581,
      stepsSource: 'average',
      trainingDay: true,
      floorApplied: false,
      parts: { bmr: 1728, base: 2073, steps: 595, training: 467, goal: 313, adjust: 0 },
    });
  });

  it('вписанные шаги важнее средних; день отдыха без тренировки; поправка по тренду', () => {
    const { norm } = computeNorm({
      card: artem,
      date: '2026-11-13',
      weightKg: 70,
      steps: 8000,
      trainingMinutes: null,
      adjust: -200,
    });
    expect(norm!.stepsSource).toBe('logged');
    expect(norm!.parts.steps).toBe(175);
    expect(norm!.parts.training).toBe(0);
    expect(norm!.kcal).toBe(Math.round((2073.0 + 175 + (2073 + 175) * 0.1 - 200) / 10) * 10);
  });

  it('не ниже 1800 ккал; без роста и даты рождения нормы нет', () => {
    const small: AthleteCard = {
      goals: { primary: 'fat_loss' },
      basics: { sex: 'female', heightCm: 155, birthDate: '1990-01-01' },
    };
    const { norm } = computeNorm({
      card: small,
      date: '2026-11-13',
      weightKg: 50,
      steps: 2000,
      trainingMinutes: null,
      adjust: 0,
    });
    expect(norm).toMatchObject({ kcal: 1800, floorApplied: true, proteinG: 110 });
    expect(
      computeNorm({
        card: { basics: { sex: 'male' } },
        date: '2026-11-13',
        weightKg: 70,
        steps: null,
        trainingMinutes: null,
        adjust: 0,
      }).missing,
    ).toEqual(['рост', 'дата рождения']);
  });
});

describe('тренд веса', () => {
  const today = '2026-11-13';
  const series = (days: number, start: number, perDay: number): WeightRow[] =>
    Array.from({ length: days }, (_, i) => ({
      date: addDays(today, -(days - 1 - i)),
      time_of_day: 'morning' as const,
      weight_kg: Math.round((start + perDay * i) * 100) / 100,
    }));

  it('в коридоре цели — калории не трогаем', () => {
    const t = computeTrend({
      rows: series(14, 70, 0.02),
      today,
      goal: 'strength_hypertrophy',
      lastAdjustAt: null,
    });
    expect(t.verdict).toBe('on_track');
    expect(t.weeklyChangeKg).toBeCloseTo(0.14, 2);
    expect(t.kcalSuggestion).toBe(0);
    expect(t.points).toHaveLength(28);
  });

  it('вес стоит при наборе — плюс калории, но не больше 300', () => {
    const flat = computeTrend({
      rows: series(14, 70, 0),
      today,
      goal: 'hypertrophy',
      lastAdjustAt: null,
    });
    expect(flat).toMatchObject({ verdict: 'too_slow', kcalSuggestion: 200 });
    expect(flat.text).toMatch(/Набор медленнее цели/);
    const drop = computeTrend({
      rows: series(14, 72, -0.1),
      today,
      goal: 'hypertrophy',
      lastAdjustAt: null,
    });
    expect(drop.kcalSuggestion).toBe(300);
    const fastCut = computeTrend({
      rows: series(14, 80, -0.03),
      today,
      goal: 'fat_loss',
      lastAdjustAt: null,
    });
    expect(fastCut.verdict).toBe('too_fast');
    expect(fastCut.kcalSuggestion).toBeLessThan(0);
    // Поправку меняли 3 дня назад — ждём.
    const recent = computeTrend({
      rows: series(14, 70, 0),
      today,
      goal: 'hypertrophy',
      lastAdjustAt: addDays(today, -3),
    });
    expect(recent.kcalSuggestion).toBe(0);
  });

  it('мало взвешиваний — просим взвешиваться; разница вечер − утро', () => {
    const rows: WeightRow[] = [
      { date: today, time_of_day: 'morning', weight_kg: 70 },
      { date: today, time_of_day: 'evening', weight_kg: 71.4 },
    ];
    const t = computeTrend({ rows, today, goal: 'strength', lastAdjustAt: null });
    expect(t.verdict).toBe('not_enough_data');
    expect(t.eveningDelta).toBe(1.4);
  });
});

describe('чем добрать белок', () => {
  it('без того, что человек не ест', () => {
    const list = proteinSuggestions(artem, 60);
    expect(list.map((f) => f.name)).not.toContain('Куриная грудка');
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ name: 'Творог 5%', grams: 240, proteinG: 41 });
    expect(proteinSuggestions(artem, 10)).toEqual([]);
  });
});

function fakeFood(responses: unknown[]) {
  const calls: JsonRequest<unknown>[] = [];
  const ai: AiProvider = {
    enabled: true,
    model: 'fake',
    generateJson<T>(req: JsonRequest<T>) {
      calls.push(req as JsonRequest<unknown>);
      for (const raw of responses.splice(0, 1)) {
        const r = req.validate(raw);
        if (r.ok) return Promise.resolve({ value: r.value, model: 'fake', tokens: 100 });
        return Promise.reject(new AiError('bad_response', r.errors.join('; ')));
      }
      return Promise.reject(new AiError('timeout', 'нет'));
    },
  };
  return { ai, calls };
}

describe('день: API', () => {
  const today = todayIn('Europe/Warsaw');

  async function person(ai: AiProvider = disabledAi) {
    const app = createApp({ authMode: 'password', ai });
    const user = await registerUser();
    const auth = bearer(user.accessToken);
    await request(app).patch('/api/v1/card').set(auth).send({ patch: artem }).expect(200);
    return { app, auth, call: () => request(app) };
  }

  it('вес утром и вечером, шаги, норма; будущий день — нельзя', async () => {
    const { auth, call } = await person();
    await call()
      .put('/api/v1/weights')
      .set(auth)
      .send({ date: today, timeOfDay: 'morning', weightKg: 70.4 })
      .expect(200);
    const res = await call()
      .put('/api/v1/weights')
      .set(auth)
      .send({ date: today, timeOfDay: 'evening', weightKg: 71.6 })
      .expect(200);
    const day = res.body as DayResponse;
    expect(day.weights).toEqual({ morning: 70.4, evening: 71.6 });
    expect(day.norm!.weightKg).toBe(70.4);
    expect(day.norm!.stepsSource).toBe('average');
    expect(day.trend.verdict).toBe('not_enough_data');

    const withSteps = (
      await call().put(`/api/v1/steps/${today}`).set(auth).send({ steps: 24000 }).expect(200)
    ).body as DayResponse;
    expect(withSteps.steps).toBe(24000);
    expect(withSteps.norm!.stepsSource).toBe('logged');
    expect(withSteps.norm!.parts.steps).toBeGreaterThan(day.norm!.parts.steps);

    await call()
      .put('/api/v1/weights')
      .set(auth)
      .send({ date: addDays(today, 1), timeOfDay: 'morning', weightKg: 70 })
      .expect(400);
    const del = (await call().delete(`/api/v1/weights/${today}/evening`).set(auth).expect(200))
      .body as DayResponse;
    expect(del.weights.evening).toBeNull();
    await call().get('/api/v1/day/not-a-date').set(auth).expect(404);
  });

  it('еда: вручную, итоги, повтор частых, удаление; белок — без мясного', async () => {
    const { auth, call } = await person();
    const meal = {
      date: today,
      mealType: 'breakfast',
      inputType: 'manual',
      title: 'Овсянка с бананом',
      items: [
        { name: 'Овсянка', grams: 80, kcal: 300, proteinG: 10, fatG: 5, carbsG: 52 },
        { name: 'Банан', grams: 120, kcal: 107, proteinG: 1.3, fatG: 0.4, carbsG: 27 },
      ],
    };
    const res = await call().post('/api/v1/meals').set(auth).send(meal).expect(201);
    let day = res.body as DayResponse;
    expect(day.meals).toHaveLength(1);
    expect(day.meals[0]!.totals).toEqual({ kcal: 407, proteinG: 11.3, fatG: 5.4, carbsG: 79 });
    expect(day.eaten.kcal).toBe(407);
    expect(day.suggestions.map((s) => s.name)).not.toContain('Куриная грудка');
    expect(day.suggestions.length).toBeGreaterThan(0);

    await call()
      .post('/api/v1/meals')
      .set(auth)
      .send({ ...meal, date: addDays(today, -1) })
      .expect(201);
    day = (await call().get(`/api/v1/day/${today}`).set(auth).expect(200)).body as DayResponse;
    expect(day.recentMeals[0]).toMatchObject({ title: 'Овсянка с бананом', times: 2 });
    expect(day.recentMeals[0]!.items).toHaveLength(2);

    await call().delete(`/api/v1/meals/${day.meals[0]!.id}`).set(auth).expect(204);
    await call().delete(`/api/v1/meals/${day.meals[0]!.id}`).set(auth).expect(404);
    day = (await call().get(`/api/v1/day/${today}`).set(auth).expect(200)).body as DayResponse;
    expect(day.eaten.kcal).toBe(0);
  });

  it('разбор еды текстом: проверка БЖУ с повтором, кэш одинакового текста', async () => {
    const good: ParsedFood = {
      items: [
        { name: 'Рис варёный', grams: 200, kcal: 260, proteinG: 5.4, fatG: 0.6, carbsG: 56 },
        { name: 'Яйцо', grams: 110, kcal: 157, proteinG: 13.8, fatG: 10.6, carbsG: 0.8 },
      ],
      note: 'Рис считал варёным',
    };
    const bad = { items: [{ ...good.items[0], kcal: 900 }] };
    const { ai, calls } = fakeFood([bad, good]);
    const { auth, call } = await person({
      ...ai,
      // Клиент сам повторяет при невалидном ответе — имитируем это здесь.
      generateJson: async (req) => {
        try {
          return await ai.generateJson(req);
        } catch {
          return ai.generateJson(req);
        }
      },
    });
    const res = await call()
      .post('/api/v1/meals/parse')
      .set(auth)
      .send({ text: '200 г риса и 2 яйца' })
      .expect(200);
    expect(res.body).toMatchObject({ cached: false, note: 'Рис считал варёным' });
    expect(res.body.items).toHaveLength(2);
    expect(calls).toHaveLength(2);

    const again = await call()
      .post('/api/v1/meals/parse')
      .set(auth)
      .send({ text: '  200 Г риса   и 2 яйца ' })
      .expect(200);
    expect(again.body.cached).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('без ИИ — понятная ошибка; поправка нормы применяется', async () => {
    const { auth, call } = await person();
    const res = await call()
      .post('/api/v1/meals/parse')
      .set(auth)
      .send({ text: 'гречка с курицей' })
      .expect(503);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');

    const before = (await call().get(`/api/v1/day/${today}`).set(auth).expect(200))
      .body as DayResponse;
    await call().put('/api/v1/nutrition/adjust').set(auth).send({ kcal: 200 }).expect(204);
    const after = (await call().get(`/api/v1/day/${today}`).set(auth).expect(200))
      .body as DayResponse;
    expect(after.calorieAdjust).toBe(200);
    expect(after.norm!.kcal).toBe(before.norm!.kcal + 200);
  });
});
