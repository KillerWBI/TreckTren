import { z } from 'zod';
import type { AthleteCard, LiftRecord, WeeklyReview, WeeklyStats } from '@trektren/shared';
import type { AiProvider } from '../../ai/client.js';
import { config } from '../../config.js';
import { addDays } from '../../dates.js';
import { pool } from '../../db.js';
import { getCard } from '../card/service.js';
import { computeNorm, computeTrend, type WeightRow } from '../day/norm.js';
import { userToday } from '../strength/service.js';
import { getProgress } from './service.js';

const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => String(r1(n)).replace('.', ',');
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** Сводка недели: вес, шаги, еда против нормы, тренировки, сон, силовые. */
export async function weeklyStats(userId: string, card: AthleteCard, today: string) {
  const weekStart = addDays(today, -6);
  const progress = await getProgress(userId, 14);
  const week = progress.days.filter((d) => d.date >= weekStart);

  const [weights, workouts, versions, profile] = await Promise.all([
    pool.query<WeightRow>(
      `SELECT date, time_of_day, weight_kg FROM weight_logs WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
      [userId, addDays(today, -21), today],
    ),
    pool.query<{ date: string; minutes: number | null }>(
      `SELECT date, extract(epoch FROM finished_at - started_at) / 60 AS minutes
       FROM workouts WHERE user_id = $1 AND date BETWEEN $2 AND $3 AND finished_at IS NOT NULL`,
      [userId, weekStart, today],
    ),
    pool.query<{ snapshot: AthleteCard; created_at: Date }>(
      `SELECT snapshot, created_at FROM card_versions WHERE user_id = $1 ORDER BY version`,
      [userId],
    ),
    pool.query<{ calorie_adjust: number; calorie_adjust_at: string | null }>(
      'SELECT calorie_adjust, calorie_adjust_at FROM profiles WHERE user_id = $1',
      [userId],
    ),
  ]);
  const adjust = profile.rows[0]?.calorie_adjust ?? 0;
  const trend = computeTrend({
    rows: weights.rows,
    today,
    goal: card.goals?.primary ?? 'general_fitness',
    lastAdjustAt: profile.rows[0]?.calorie_adjust_at ?? null,
  });

  // Норма по каждому дню, где записана еда: шаги и тренировка того дня.
  const trainedOn = new Map(workouts.rows.map((w) => [w.date, w.minutes]));
  const norms: number[] = [];
  const eaten: number[] = [];
  const protein: number[] = [];
  let proteinNorm: number | null = null;
  for (const d of week.filter((x) => x.kcal !== null)) {
    const minutes = trainedOn.get(d.date);
    const { norm } = computeNorm({
      card,
      date: d.date,
      weightKg: trend.avg7 ?? card.basics?.weightKg ?? null,
      steps: d.steps,
      trainingMinutes: minutes !== undefined ? Math.min(180, Math.max(20, minutes ?? 60)) : null,
      adjust,
    });
    if (!norm) continue;
    norms.push(norm.kcal);
    eaten.push(d.kcal!);
    protein.push(d.proteinG ?? 0);
    proteinNorm = norm.proteinG;
  }

  // Максимумы: как было в начале недели и как стало.
  const before = [...versions.rows]
    .reverse()
    .find((v) => v.created_at.toISOString().slice(0, 10) < weekStart)?.snapshot.strength?.lifts;
  const now = card.strength?.lifts ?? {};
  const names: Record<string, string> = {
    'barbell-back-squat': 'Присед',
    'bench-press': 'Жим лёжа',
    deadlift: 'Становая',
    'overhead-press': 'Жим стоя',
    'barbell-row': 'Тяга в наклоне',
  };
  const strength = Object.entries(now)
    .filter(([slug]) => names[slug])
    .flatMap(([slug, l]: [string, LiftRecord]) => {
      const was = before?.[slug]?.oneRmKg;
      return was !== undefined && Math.abs(was - l.oneRmKg) >= 0.5
        ? [{ name: names[slug]!, fromKg: was, toKg: l.oneRmKg }]
        : [];
    });

  const planned = await pool.query<{ total: number; done: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM workouts w WHERE w.session_id = s.id AND w.finished_at IS NOT NULL)
                             OR s.result_json IS NOT NULL)::int AS done
     FROM scheduled_sessions s JOIN training_blocks b ON b.id = s.block_id
     WHERE s.user_id = $1 AND s.date BETWEEN $2 AND $3
       AND jsonb_array_length(s.planned_json->'exercises') > 0`,
    [userId, weekStart, today],
  );
  const sessionsPlanned = planned.rows[0]?.total ?? 0;
  const sessionsDone = planned.rows[0]?.done ?? 0;
  const pastPlanned = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM scheduled_sessions s
     WHERE s.user_id = $1 AND s.date BETWEEN $2 AND $3 AND s.status = 'planned'
       AND jsonb_array_length(s.planned_json->'exercises') > 0
       AND NOT EXISTS (SELECT 1 FROM workouts w WHERE w.session_id = s.id)`,
    [userId, weekStart, addDays(today, -1)],
  );

  const stepsDays = week.filter((d) => d.steps !== null);
  const sleep = week.flatMap((d) => (d.sleepHours !== null ? [d.sleepHours] : []));
  const well = week.flatMap((d) => (d.wellbeing !== null ? [d.wellbeing] : []));
  const stats: WeeklyStats = {
    weightChangeKg: trend.weeklyChangeKg,
    weightChangePct: trend.weeklyChangePct,
    avgSteps: stepsDays.length ? Math.round(mean(stepsDays.map((d) => d.steps!))!) : null,
    stepsDays: stepsDays.length,
    avgKcal: eaten.length ? Math.round(mean(eaten)!) : null,
    avgNormKcal: norms.length ? Math.round(mean(norms)!) : null,
    avgProteinG: protein.length ? Math.round(mean(protein)!) : null,
    proteinNormG: proteinNorm,
    foodDays: eaten.length,
    sessionsPlanned,
    sessionsDone,
    sessionsMissed: pastPlanned.rows[0]?.n ?? 0,
    avgSleepHours: sleep.length ? r1(mean(sleep)!) : null,
    avgWellbeing: well.length ? r1(mean(well)!) : null,
    strength,
  };
  return { weekStart, stats, trend };
}

/** Решения по неделе — кодом: калории в рамках ±300, объём вверх / держим / вниз. */
export function decide(stats: WeeklyStats, trendSuggestion: number, trendText: string) {
  const points: string[] = [];
  points.push(trendText);

  if (stats.avgKcal !== null && stats.avgNormKcal) {
    const pct = Math.round((stats.avgKcal / stats.avgNormKcal) * 100);
    points.push(
      `Калории: в среднем ${stats.avgKcal} из ${stats.avgNormKcal} (${pct}%) за ${stats.foodDays} дн. с записями.${pct < 90 ? ' Недоедаешь — рост встанет.' : pct > 110 ? ' Перебор — лишнее уйдёт в жир.' : ''}`,
    );
  } else {
    points.push('Еда не записана — без неё калории не сверить. Записывай хотя бы основные приёмы.');
  }
  if (stats.avgProteinG !== null && stats.proteinNormG) {
    points.push(
      `Белок: ${stats.avgProteinG} г из ${stats.proteinNormG}.${stats.avgProteinG < stats.proteinNormG * 0.85 ? ' Мало — мышцам не из чего расти.' : ''}`,
    );
  }
  if (stats.avgSteps !== null)
    points.push(
      `Шаги: в среднем ${stats.avgSteps.toLocaleString('ru-RU')} за ${stats.stepsDays} дн.`,
    );
  if (stats.sessionsPlanned > 0) {
    points.push(
      `Тренировки: ${stats.sessionsDone} из ${stats.sessionsPlanned}${stats.sessionsMissed ? `, пропущено ${stats.sessionsMissed}` : ''}.`,
    );
  }
  if (stats.avgSleepHours !== null) {
    points.push(
      `Сон: ${fmt(stats.avgSleepHours)} ч в среднем.${stats.avgSleepHours < 7 ? ' Меньше 7 часов — восстановление проседает.' : ''}`,
    );
  }
  for (const s of stats.strength)
    points.push(`${s.name}: максимум ${fmt(s.fromKg)} → ${fmt(s.toKg)} кг.`);

  let volume: WeeklyReview['volume'] = 'keep';
  let volumeText = 'Объём держим: план работает.';
  const tired =
    (stats.avgWellbeing !== null && stats.avgWellbeing <= 2.3) ||
    (stats.avgSleepHours !== null && stats.avgSleepHours < 6.5);
  if (stats.sessionsMissed >= 2 || tired) {
    volume = 'down';
    volumeText = tired
      ? 'Объём вниз на подход в подсобке: сон и самочувствие не дают восстановиться.'
      : 'Объём вниз на подход в подсобке: два пропуска — значит, план не влезает в неделю. Лучше меньше, но без пропусков.';
  } else if (
    stats.sessionsPlanned > 0 &&
    stats.sessionsDone >= stats.sessionsPlanned &&
    stats.strength.some((s) => s.toKg > s.fromKg) &&
    (stats.avgWellbeing ?? 3) >= 3.5
  ) {
    volume = 'up';
    volumeText =
      'Объём вверх: +1 подход в подсобке на отстающие движения — всё сделано и силы растут.';
  }
  return { points, kcalDelta: trendSuggestion, volume, volumeText };
}

const textSchema = z.object({ text: z.string().min(1).max(1500) });

export async function createWeeklyReview(userId: string, ai: AiProvider): Promise<WeeklyReview> {
  const today = await userToday(userId);
  const { card } = await getCard(userId);
  const { weekStart, stats, trend } = await weeklyStats(userId, card, today);
  const goal = card.goals?.primary ?? 'general_fitness';
  const decision = decide(stats, trend.kcalSuggestion, trend.text);

  let text = decision.points.join(' ');
  let source: WeeklyReview['source'] = 'rules';
  if (ai.enabled && (await underQuota(userId, today))) {
    try {
      const result = await ai.generateJson({
        name: 'weekly_review',
        task: 'review',
        schema: textSchema,
        maxTokens: 6000,
        messages: [
          {
            role: 'system',
            content:
              'Ты строгий тренер. По сводке недели напиши человеку разбор: 3–5 предложений, без воды и похвалы ради похвалы. Главное — что мешает результату и что сделать на следующей неделе. Цифры и решения бери ровно из сводки, свои не придумывай. Без английских сокращений. Ответ — JSON {"text": "..."}.',
          },
          {
            role: 'user',
            content: [
              `Цель: ${goal}.`,
              ...decision.points,
              `Решение по калориям: ${decision.kcalDelta === 0 ? 'не менять' : `${decision.kcalDelta > 0 ? '+' : ''}${decision.kcalDelta} ккал в день`}.`,
              `Решение по объёму: ${decision.volumeText}`,
            ].join('\n'),
          },
        ],
        validate: (raw) => {
          const r = textSchema.safeParse(raw);
          return r.success
            ? { ok: true, value: r.data }
            : { ok: false, errors: ['нужно поле text'] };
        },
      });
      text = result.value.text;
      source = 'ai';
      await recordUsage(userId, today, result.tokens);
    } catch (err) {
      console.warn(`[ai] недельный разбор без ИИ: ${(err as Error).message}`);
    }
  }

  const output = {
    weekStart,
    weekEnd: today,
    stats,
    kcalDelta: decision.kcalDelta,
    volume: decision.volume,
    volumeText: decision.volumeText,
    points: decision.points,
    text,
    source,
  };
  const { rows } = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO ai_reports (user_id, kind, period_start, input_json, output_json)
     VALUES ($1, 'weekly', $2, $3, $4) RETURNING id, created_at`,
    [userId, weekStart, JSON.stringify(stats), JSON.stringify(output)],
  );
  return { id: rows[0]!.id, createdAt: rows[0]!.created_at.toISOString(), ...output };
}

export async function latestWeeklyReview(userId: string): Promise<WeeklyReview | null> {
  const { rows } = await pool.query<{
    id: string;
    output_json: Omit<WeeklyReview, 'id' | 'createdAt'>;
    created_at: Date;
  }>(
    `SELECT id, output_json, created_at FROM ai_reports
     WHERE user_id = $1 AND kind = 'weekly' ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const r = rows[0];
  return r ? { id: r.id, createdAt: r.created_at.toISOString(), ...r.output_json } : null;
}

async function underQuota(userId: string, today: string) {
  const { rows } = await pool.query<{ requests: number }>(
    `SELECT requests FROM ai_usage WHERE user_id = $1 AND date = $2 AND kind = 'review'`,
    [userId, today],
  );
  return (rows[0]?.requests ?? 0) < config.AI_DAILY_LIMIT;
}

async function recordUsage(userId: string, today: string, tokens: number) {
  await pool.query(
    `INSERT INTO ai_usage (user_id, date, kind, requests, tokens) VALUES ($1, $2, 'review', 1, $3)
     ON CONFLICT (user_id, date, kind)
     DO UPDATE SET requests = ai_usage.requests + 1, tokens = ai_usage.tokens + EXCLUDED.tokens`,
    [userId, today, tokens],
  );
}
