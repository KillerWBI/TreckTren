import { createHash } from 'node:crypto';
import {
  parsedFoodSchema,
  type DayResponse,
  type Macros,
  type MealInput,
  type MealItem,
  type MealView,
  type ParsedFood,
  type PlannedSession,
  type SessionView,
  type TimeOfDay,
  type WellbeingInput,
} from '@trektren/shared';
import { AiError, type AiProvider } from '../../ai/client.js';
import { config } from '../../config.js';
import { addDays } from '../../dates.js';
import { pool, withTransaction } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { getCard } from '../card/service.js';
import { userToday } from '../strength/service.js';
import { proteinSuggestions } from './foods.js';
import { computeNorm, computeTrend, type WeightRow } from './norm.js';

/** Задним числом можно править до 60 дней; будущие дни — нельзя. */
const MAX_DAYS_BACK = 60;

async function checkDate(userId: string, date: string): Promise<string> {
  const today = await userToday(userId);
  if (date > today) throw new AppError(400, 'VALIDATION_ERROR', 'Этот день ещё не наступил');
  if (date < addDays(today, -MAX_DAYS_BACK)) {
    throw new AppError(400, 'VALIDATION_ERROR', `Править можно последние ${MAX_DAYS_BACK} дней`);
  }
  return today;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function sum(items: Array<Macros>): Macros {
  return items.reduce(
    (a, b) => ({
      kcal: r1(a.kcal + b.kcal),
      proteinG: r1(a.proteinG + b.proteinG),
      fatG: r1(a.fatG + b.fatG),
      carbsG: r1(a.carbsG + b.carbsG),
    }),
    { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
  );
}

interface MealRow {
  id: string;
  meal_type: MealView['mealType'];
  input_type: MealView['inputType'];
  raw_text: string | null;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  created_at: Date;
  items: Array<{
    name: string;
    grams: number;
    kcal: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  }> | null;
}

const toItem = (i: NonNullable<MealRow['items']>[number]): MealItem => ({
  name: i.name,
  grams: Number(i.grams),
  kcal: Number(i.kcal),
  proteinG: Number(i.protein_g),
  fatG: Number(i.fat_g),
  carbsG: Number(i.carbs_g),
});

const MEAL_SELECT = `
  SELECT m.id::text, m.meal_type, m.input_type, m.raw_text, m.kcal, m.protein_g, m.fat_g, m.carbs_g,
         m.created_at,
         (SELECT json_agg(json_build_object('name', i.name, 'grams', i.grams, 'kcal', i.kcal,
                 'protein_g', i.protein_g, 'fat_g', i.fat_g, 'carbs_g', i.carbs_g) ORDER BY i.id)
          FROM meal_items i WHERE i.meal_id = m.id) AS items
  FROM meals m`;

function toMeal(r: MealRow): MealView {
  return {
    id: r.id,
    mealType: r.meal_type,
    inputType: r.input_type,
    title: r.raw_text ?? 'Приём пищи',
    items: (r.items ?? []).map(toItem),
    totals: { kcal: r.kcal, proteinG: r.protein_g, fatG: r.fat_g, carbsG: r.carbs_g },
    createdAt: r.created_at.toISOString(),
  };
}

export async function getDay(userId: string, date: string): Promise<DayResponse> {
  await checkDate(userId, date);
  const today = await userToday(userId);
  const [{ card }, profile, weights, steps, meals, session, workout, recent, wellbeing] =
    await Promise.all([
      getCard(userId),
      pool.query<{ calorie_adjust: number; calorie_adjust_at: string | null }>(
        'SELECT calorie_adjust, calorie_adjust_at FROM profiles WHERE user_id = $1',
        [userId],
      ),
      pool.query<WeightRow>(
        `SELECT date, time_of_day, weight_kg FROM weight_logs
       WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
        [userId, addDays(date, -42), date],
      ),
      pool.query<{ steps: number }>(
        'SELECT steps FROM step_logs WHERE user_id = $1 AND date = $2',
        [userId, date],
      ),
      pool.query<MealRow>(
        `${MEAL_SELECT} WHERE m.user_id = $1 AND m.date = $2 ORDER BY m.created_at`,
        [userId, date],
      ),
      pool.query<{ id: string; status: string; planned_json: PlannedSession }>(
        `SELECT s.id, s.status, s.planned_json FROM scheduled_sessions s
       JOIN training_blocks b ON b.id = s.block_id AND b.status = 'active'
       WHERE s.user_id = $1 AND s.date = $2 LIMIT 1`,
        [userId, date],
      ),
      pool.query<{ id: string; started_at: Date; finished_at: Date | null }>(
        `SELECT id, started_at, finished_at FROM workouts WHERE user_id = $1 AND date = $2
       ORDER BY started_at DESC LIMIT 1`,
        [userId, date],
      ),
      pool.query<MealRow & { times: number }>(
        `SELECT DISTINCT ON (lower(m.raw_text)) m.id::text, m.meal_type, m.input_type, m.raw_text, m.kcal,
              m.protein_g, m.fat_g, m.carbs_g, m.created_at,
              (SELECT count(*)::int FROM meals x WHERE x.user_id = m.user_id
                 AND lower(x.raw_text) = lower(m.raw_text) AND x.date > $2) AS times,
              (SELECT json_agg(json_build_object('name', i.name, 'grams', i.grams, 'kcal', i.kcal,
                      'protein_g', i.protein_g, 'fat_g', i.fat_g, 'carbs_g', i.carbs_g) ORDER BY i.id)
               FROM meal_items i WHERE i.meal_id = m.id) AS items
       FROM meals m WHERE m.user_id = $1 AND m.date > $2 AND m.raw_text IS NOT NULL
       ORDER BY lower(m.raw_text), m.created_at DESC`,
        [userId, addDays(today, -30)],
      ),
      pool.query<{
        sleep_hours: number | null;
        sleep_score: number | null;
        wellbeing_score: number | null;
      }>(
        'SELECT sleep_hours, sleep_score, wellbeing_score FROM wellbeing_logs WHERE user_id = $1 AND date = $2',
        [userId, date],
      ),
    ]);

  const adjust = profile.rows[0]?.calorie_adjust ?? 0;
  const trend = computeTrend({
    rows: weights.rows,
    today: date,
    goal: card.goals?.primary ?? 'general_fitness',
    lastAdjustAt: profile.rows[0]?.calorie_adjust_at ?? null,
  });
  const latestMorning = [...weights.rows].reverse().find((r) => r.time_of_day === 'morning');
  const weightKg = trend.avg7 ?? latestMorning?.weight_kg ?? card.basics?.weightKg ?? null;

  const s = session.rows[0];
  const w = workout.rows[0];
  const trainingDay = Boolean(
    w || (s && s.planned_json.exercises.length > 0 && s.planned_json.phase !== 'after_block'),
  );
  let trainingMinutes: number | null = null;
  if (trainingDay) {
    trainingMinutes = card.availability?.sessionMinutes ?? 60;
    if (w?.finished_at) {
      const minutes = (w.finished_at.getTime() - w.started_at.getTime()) / 60000;
      trainingMinutes = Math.min(180, Math.max(20, Math.round(minutes)));
    }
  }

  const { norm, missing } = computeNorm({
    card,
    date,
    weightKg,
    steps: steps.rows[0]?.steps ?? null,
    trainingMinutes,
    adjust,
  });
  const mealViews = meals.rows.map(toMeal);
  const eaten = sum(mealViews.map((m) => m.totals));
  const dayWeights = weights.rows.filter((r) => r.date === date);

  return {
    date,
    norm,
    normMissing: missing,
    eaten,
    meals: mealViews,
    weights: {
      morning: dayWeights.find((r) => r.time_of_day === 'morning')?.weight_kg ?? null,
      evening: dayWeights.find((r) => r.time_of_day === 'evening')?.weight_kg ?? null,
    },
    steps: steps.rows[0]?.steps ?? null,
    trend,
    session: s
      ? {
          id: s.id,
          title: s.planned_json.title,
          status: (w?.finished_at ? 'done' : s.status) as SessionView['status'],
        }
      : null,
    workout: w ? { id: w.id, finished: Boolean(w.finished_at) } : null,
    suggestions: norm ? proteinSuggestions(card, norm.proteinG - eaten.proteinG) : [],
    recentMeals: recent.rows
      .filter((r) => r.times >= 1)
      .sort((a, b) => b.times - a.times)
      .slice(0, 8)
      .map((r) => {
        const meal = toMeal(r);
        return { title: meal.title, items: meal.items, totals: meal.totals, times: r.times };
      }),
    calorieAdjust: adjust,
    wellbeing: {
      sleepHours: wellbeing.rows[0]?.sleep_hours ?? null,
      sleepScore: wellbeing.rows[0]?.sleep_score ?? null,
      wellbeingScore: wellbeing.rows[0]?.wellbeing_score ?? null,
    },
  };
}

export async function putWeight(
  userId: string,
  date: string,
  timeOfDay: TimeOfDay,
  weightKg: number,
) {
  await checkDate(userId, date);
  await pool.query(
    `INSERT INTO weight_logs (user_id, date, time_of_day, weight_kg) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, date, time_of_day) DO UPDATE SET weight_kg = EXCLUDED.weight_kg`,
    [userId, date, timeOfDay, weightKg],
  );
}

export async function deleteWeight(userId: string, date: string, timeOfDay: TimeOfDay) {
  await checkDate(userId, date);
  await pool.query(
    'DELETE FROM weight_logs WHERE user_id = $1 AND date = $2 AND time_of_day = $3',
    [userId, date, timeOfDay],
  );
}

export async function putSteps(userId: string, date: string, steps: number) {
  await checkDate(userId, date);
  await pool.query(
    `INSERT INTO step_logs (user_id, date, steps) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, date) DO UPDATE SET steps = EXCLUDED.steps`,
    [userId, date, steps],
  );
}

export async function addMeal(userId: string, input: MealInput): Promise<void> {
  await checkDate(userId, input.date);
  const items = input.items.map((i) => ({
    ...i,
    kcal: r1(i.kcal),
    proteinG: r1(i.proteinG),
    fatG: r1(i.fatG),
    carbsG: r1(i.carbsG),
  }));
  const total = sum(items);
  await withTransaction(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO meals (user_id, date, meal_type, input_type, raw_text, kcal, protein_g, fat_g, carbs_g)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        userId,
        input.date,
        input.mealType,
        input.inputType,
        input.title,
        total.kcal,
        total.proteinG,
        total.fatG,
        total.carbsG,
      ],
    );
    const values: unknown[] = [];
    const placeholders = items.map((i, n) => {
      values.push(rows[0]!.id, i.name, i.grams, i.kcal, i.proteinG, i.fatG, i.carbsG);
      const b = n * 7;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`;
    });
    await c.query(
      `INSERT INTO meal_items (meal_id, name, grams, kcal, protein_g, fat_g, carbs_g)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  });
}

export async function deleteMeal(userId: string, id: string) {
  if (!/^\d{1,18}$/.test(id)) throw notFound('Приём пищи не найден');
  const { rowCount } = await pool.query('DELETE FROM meals WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ]);
  if (!rowCount) throw notFound('Приём пищи не найден');
}

export async function setCalorieAdjust(userId: string, kcal: number) {
  const today = await userToday(userId);
  await pool.query(
    'UPDATE profiles SET calorie_adjust = $2, calorie_adjust_at = $3 WHERE user_id = $1',
    [userId, kcal, today],
  );
}

/* Разбор еды текстом ----------------------------------------------------- */

const FOOD_SYSTEM = `Ты считаешь калории. Разбери приём пищи на продукты и посчитай КБЖУ по средним справочным данным.
Для каждого продукта: name — коротко по-русски; grams — масса в граммах (штуки и ложки переведи: яйцо ~55 г без скорлупы, ломтик хлеба ~30 г, столовая ложка масла ~15 г, банан ~120 г); kcal, proteinG, fatG, carbsG — на эту массу.
Крупы и макароны — если не сказано «сухой», считай варёными. Ответ — только JSON {"items": [...], "note": "..."}; note — одной фразой, что предположил, если было неоднозначно (жирность, способ готовки). Ничего не выдумывай сверх сказанного.`;

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Белки и углеводы по 4 ккал, жиры по 9: если калории сильно расходятся с БЖУ — ответ кривой. */
function checkItems(food: ParsedFood): string[] {
  const errors: string[] = [];
  food.items.forEach((i, n) => {
    const fromMacros = i.proteinG * 4 + i.carbsG * 4 + i.fatG * 9;
    if (i.kcal > 30 && Math.abs(fromMacros - i.kcal) / i.kcal > 0.35) {
      errors.push(
        `items.${n} (${i.name}): ккал ${i.kcal} не сходятся с БЖУ (${Math.round(fromMacros)})`,
      );
    }
  });
  return errors;
}

export async function parseMeal(
  userId: string,
  text: string,
  ai: AiProvider,
): Promise<ParsedFood & { cached: boolean }> {
  const key = createHash('sha256').update(normalize(text)).digest('hex');
  const cached = await pool.query<{ result: ParsedFood }>(
    'SELECT result FROM food_parse_cache WHERE text_key = $1',
    [key],
  );
  if (cached.rows[0]) return { ...cached.rows[0].result, cached: true };

  if (!ai.enabled) {
    throw new AppError(503, 'FEATURE_DISABLED', 'ИИ не подключён — впиши продукты вручную');
  }
  const today = await userToday(userId);
  const { rows } = await pool.query<{ requests: number }>(
    `SELECT requests FROM ai_usage WHERE user_id = $1 AND date = $2 AND kind = 'food'`,
    [userId, today],
  );
  if ((rows[0]?.requests ?? 0) >= config.AI_DAILY_LIMIT) {
    throw new AppError(
      429,
      'RATE_LIMITED',
      'На сегодня лимит разборов еды исчерпан — впиши вручную',
    );
  }

  try {
    const result = await ai.generateJson<ParsedFood>({
      name: 'meal',
      task: 'food',
      schema: parsedFoodSchema,
      maxTokens: 6000,
      messages: [
        { role: 'system', content: FOOD_SYSTEM },
        { role: 'user', content: text },
      ],
      validate: (raw) => {
        const parsed = parsedFoodSchema.safeParse(raw);
        if (!parsed.success) {
          return {
            ok: false,
            errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          };
        }
        const errors = checkItems(parsed.data);
        return errors.length > 0 ? { ok: false, errors } : { ok: true, value: parsed.data };
      },
    });
    await recordUsage(userId, today, result.tokens);
    const food: ParsedFood = {
      items: result.value.items.map((i) => ({
        ...i,
        grams: Math.round(i.grams),
        kcal: Math.round(i.kcal),
        proteinG: r1(i.proteinG),
        fatG: r1(i.fatG),
        carbsG: r1(i.carbsG),
      })),
      ...(result.value.note ? { note: result.value.note } : {}),
    };
    await pool.query(
      'INSERT INTO food_parse_cache (text_key, result) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [key, JSON.stringify(food)],
    );
    return { ...food, cached: false };
  } catch (err) {
    if (!(err instanceof AiError)) throw err;
    await recordUsage(userId, today, 0);
    console.warn(`[ai] разбор еды не удался: ${err.kind}: ${err.message}`);
    throw new AppError(
      502,
      'AI_UNAVAILABLE',
      err.kind === 'timeout'
        ? 'ИИ не ответил вовремя — повтори или впиши вручную'
        : 'ИИ не смог разобрать — переформулируй или впиши вручную',
    );
  }
}

async function recordUsage(userId: string, today: string, tokens: number) {
  await pool.query(
    `INSERT INTO ai_usage (user_id, date, kind, requests, tokens) VALUES ($1, $2, 'food', 1, $3)
     ON CONFLICT (user_id, date, kind)
     DO UPDATE SET requests = ai_usage.requests + 1, tokens = ai_usage.tokens + EXCLUDED.tokens`,
    [userId, today, tokens],
  );
}

/** Сон и самочувствие за день: пришедшие поля меняются, null стирает, остальное не трогается. */
export async function putWellbeing(userId: string, date: string, input: WellbeingInput) {
  await checkDate(userId, date);
  const cols = {
    sleep_hours: input.sleepHours,
    sleep_score: input.sleepScore,
    wellbeing_score: input.wellbeingScore,
  };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (set.length === 0) return;
  const names = set.map(([k]) => k);
  const values = set.map(([, v]) => v);
  await pool.query(
    `INSERT INTO wellbeing_logs (user_id, date, ${names.join(', ')})
     VALUES ($1, $2, ${names.map((_, i) => `$${i + 3}`).join(', ')})
     ON CONFLICT (user_id, date) DO UPDATE SET ${names.map((n) => `${n} = EXCLUDED.${n}`).join(', ')}`,
    [userId, date, ...values],
  );
}
