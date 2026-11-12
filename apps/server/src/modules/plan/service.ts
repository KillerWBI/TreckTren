import type { PoolClient } from 'pg';
import {
  blockTemplateSchema,
  epleyOneRm,
  isSectionFilled,
  REQUIRED_CARD_SECTIONS,
  type AthleteCard,
  type BaselineRequest,
  type BlockTemplate,
  type BlockView,
  type GeneratePlanRequest,
  type PlannedSession,
  type PlanResponse,
  type PlanSource,
  type SessionView,
} from '@trektren/shared';
import { AiError, type AiProvider } from '../../ai/client.js';
import { config } from '../../config.js';
import { addDays, todayIn, uniqueSorted } from '../../dates.js';
import { pool, withTransaction } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { applyCardPatch, getCard } from '../card/service.js';
import { loadExercises, type Exercise } from '../exercises/repo.js';
import { filterAvailable } from './availability.js';
import { layoutSessions, type LaidOutSession } from './layout.js';
import { loadFor } from './loads.js';
import { normalizeTemplate } from './normalize.js';
import { buildPlanMessages } from './prompt.js';
import { buildRulesTemplate } from './rules.js';
import { describeSchedule } from './schedule.js';

const AI_FAILURE_TEXT: Record<AiError['kind'], string> = {
  not_configured: 'ИИ не подключён',
  rate_limited: 'У ИИ закончился лимит запросов',
  timeout: 'ИИ не ответил вовремя',
  http: 'ИИ вернул ошибку',
  bad_response: 'ИИ вернул план, который не прошёл проверку',
};

/** Насколько вперёд можно ставить тренировки. */
const MAX_DAYS_AHEAD = 56;

interface StoredPlan {
  template: BlockTemplate;
  source: PlanSource;
  model: string | null;
  comment: string | null;
  generationNote: string | null;
  excluded: string[];
}

interface BlockRow {
  id: string;
  start_date: string;
  weeks: number;
  plan_json: StoredPlan;
  created_at: Date;
}

interface SessionRow {
  id: string;
  date: string;
  status: SessionView['status'];
  planned_json: PlannedSession;
}

export async function getPlan(userId: string, ai: AiProvider): Promise<PlanResponse> {
  const aiStatus = { enabled: ai.enabled, model: ai.model };
  const block = await activeBlock(pool, userId);
  if (!block) return { block: null, sessions: [], ai: aiStatus };

  const [{ rows }, { card }, exercises] = await Promise.all([
    pool.query<SessionRow>(
      'SELECT id, date, status, planned_json FROM scheduled_sessions WHERE block_id = $1 ORDER BY date',
      [block.id],
    ),
    getCard(userId),
    exerciseMap(),
  ]);
  const maxes = card.strength?.lifts ?? {};

  const sessions: SessionView[] = rows.map((r) => ({
    id: r.id,
    date: r.date,
    status: r.status,
    ...r.planned_json,
    exercises: r.planned_json.exercises.map((x) => {
      const exercise = exercises.get(x.slug);
      return {
        ...x,
        name: exercise?.name ?? x.slug,
        load: loadFor(x, exercise, maxes[x.slug]?.oneRmKg),
      };
    }),
  }));
  return { block: toBlockView(block), sessions, ai: aiStatus };
}

export async function generatePlan(
  userId: string,
  request: GeneratePlanRequest,
  ai: AiProvider,
): Promise<PlanResponse> {
  const today = await userToday(userId);
  const dates = checkDates(request.dates, today);
  const { card } = await getCard(userId);

  const missing = REQUIRED_CARD_SECTIONS.filter((s) => !isSectionFilled(card, s));
  if (missing.length > 0) {
    throw new AppError(422, 'CARD_INCOMPLETE', 'Сначала заполни обязательные разделы карточки', {
      sections: missing,
    });
  }

  const all = await loadExercises();
  const { available, excluded } = filterAvailable(all, card);
  if (available.length < 4) {
    throw new AppError(
      422,
      'CARD_INCOMPLETE',
      'Слишком мало доступных упражнений: проверь оборудование и ограничения в карточке',
    );
  }

  const schedule = describeSchedule(dates, card.availability?.sessionsPerWeek);
  const previous = await activeBlock(pool, userId);
  const comment = request.comment?.trim() || null;

  let template: BlockTemplate | undefined;
  let source: PlanSource = 'rules';
  let model: string | null = null;
  let generationNote: string | null = null;

  if (ai.enabled) {
    await assertAiQuota(userId, today);
    try {
      const result = await ai.generateJson<BlockTemplate>({
        name: 'block_template',
        schema: blockTemplateSchema,
        messages: buildPlanMessages({
          card,
          schedule,
          available,
          knownMaxes: knownMaxes(card, available),
          previous: previous?.plan_json.template,
          comment: comment ?? undefined,
        }),
        validate: (raw) => {
          const n = normalizeTemplate(raw, available);
          return n.ok ? { ok: true, value: n.template } : { ok: false, errors: n.errors };
        },
      });
      template = result.value;
      source = 'ai';
      model = result.model;
      await recordAiUsage(userId, today, result.tokens);
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      await recordAiUsage(userId, today, 0);
      // В лог — только причина от провайдера, без карточки и промпта.
      console.warn(`[ai] план собран по правилам: ${err.kind}: ${err.message}`);
      generationNote = `${AI_FAILURE_TEXT[err.kind]} — план собран по правилам. Нажми «Перестроить» чуть позже.`;
    }
  }
  template ??= buildRulesTemplate(card, available, schedule);
  if (source === 'rules' && comment && !generationNote) {
    generationNote =
      'Комментарий учтёт ИИ, когда он будет подключён: по правилам план строится без комментариев.';
  }

  const exercises = new Map(all.map((e) => [e.slug, e]));
  const laid = layoutSessions(template, dates, exercises);
  const stored: StoredPlan = {
    template,
    source,
    model,
    comment,
    generationNote,
    excluded: excluded.map((e) => e.name),
  };

  try {
    await withTransaction(async (c) => {
      await c.query(
        `UPDATE training_blocks SET status = 'closed' WHERE user_id = $1 AND status = 'active'`,
        [userId],
      );
      await c.query(
        `DELETE FROM scheduled_sessions WHERE user_id = $1 AND status = 'planned' AND date >= $2`,
        [userId, today],
      );
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO training_blocks (user_id, goal_snapshot, start_date, weeks, deload_week, plan_json)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          userId,
          JSON.stringify(card.goals ?? {}),
          dates[0],
          template.accumulationWeeks,
          template.accumulationWeeks + 1,
          JSON.stringify(stored),
        ],
      );
      await insertSessions(c, userId, rows[0]!.id, laid);
    });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new AppError(409, 'VERSION_CONFLICT', 'План уже перестраивается, обнови страницу');
    }
    throw err;
  }
  return getPlan(userId, ai);
}

/** Новые дни для текущего блока: раскладка заново, без ИИ. Прошедшие даты не трогаем. */
export async function updateSchedule(
  userId: string,
  datesInput: string[],
  ai: AiProvider,
): Promise<PlanResponse> {
  const today = await userToday(userId);
  const future = checkDates(datesInput, today);
  const exercises = await exerciseMap();

  await withTransaction(async (c) => {
    const block = await activeBlock(c, userId, true);
    if (!block) throw notFound('Сначала построй план');
    const { rows: past } = await c.query<{ date: string }>(
      `SELECT date FROM scheduled_sessions WHERE block_id = $1 AND date < $2`,
      [block.id, today],
    );
    const dates = uniqueSorted([...past.map((r) => r.date), ...future]);
    const start = dates[0]! < block.start_date ? dates[0]! : block.start_date;
    // Раскладываем все даты, чтобы недели и ротация шли от начала блока, а пишем только будущие.
    const laid = layoutSessions(block.plan_json.template, dates, exercises, start).filter(
      (s) => s.date >= today,
    );

    await c.query(
      `DELETE FROM scheduled_sessions WHERE block_id = $1 AND status = 'planned' AND date >= $2`,
      [block.id, today],
    );
    await c.query('UPDATE training_blocks SET start_date = $2 WHERE id = $1', [block.id, start]);
    await insertSessions(c, userId, block.id, laid);
  });
  return getPlan(userId, ai);
}

/** Стартовые веса: вес × повторы → расчётный 1ПМ в разделе «Силовые» карточки. */
export async function saveBaseline(userId: string, request: BaselineRequest) {
  const exercises = await exerciseMap();
  const today = await userToday(userId);
  const lifts: Record<string, { oneRmKg: number; estimated: boolean; updatedAt: string }> = {};
  for (const lift of request.lifts) {
    const exercise = exercises.get(lift.slug);
    if (!exercise || exercise.bodyweight) {
      throw new AppError(400, 'VALIDATION_ERROR', `Для «${lift.slug}» стартовый вес не задаётся`);
    }
    lifts[lift.slug] = {
      oneRmKg: Math.round(epleyOneRm(lift.weightKg, lift.reps) * 10) / 10,
      estimated: lift.reps > 1,
      updatedAt: today,
    };
  }
  return applyCardPatch(
    userId,
    { strength: { lifts } },
    { source: 'user', reason: 'Стартовые веса', allowedSections: ['strength'] },
  );
}

async function insertSessions(
  c: PoolClient,
  userId: string,
  blockId: string,
  laid: LaidOutSession[],
) {
  if (laid.length === 0) return;
  const values: unknown[] = [];
  const rows = laid.map((s, i) => {
    values.push(userId, blockId, s.date, JSON.stringify(s.planned));
    return `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`;
  });
  await c.query(
    `INSERT INTO scheduled_sessions (user_id, block_id, date, planned_json) VALUES ${rows.join(', ')}`,
    values,
  );
}

async function activeBlock(db: PoolClient | typeof pool, userId: string, lock = false) {
  const { rows } = await db.query<BlockRow>(
    `SELECT id, start_date, weeks, plan_json, created_at FROM training_blocks
     WHERE user_id = $1 AND status = 'active'${lock ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  return rows[0];
}

function toBlockView(b: BlockRow): BlockView {
  const p = b.plan_json;
  return {
    id: b.id,
    startDate: b.start_date,
    accumulationWeeks: b.weeks,
    split: p.template.split,
    rationale: p.template.rationale,
    coachNote: p.template.coachNote,
    source: p.source,
    model: p.model,
    comment: p.comment,
    generationNote: p.generationNote,
    excluded: p.excluded,
    createdAt: b.created_at.toISOString(),
  };
}

function checkDates(input: string[], today: string): string[] {
  const dates = uniqueSorted(input);
  const last = addDays(today, MAX_DAYS_AHEAD);
  if (dates.some((d) => d < today)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Прошедшие дни выбрать нельзя');
  }
  if (dates.some((d) => d > last)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Тренировки можно ставить не дальше чем на ${MAX_DAYS_AHEAD / 7} недель вперёд`,
    );
  }
  return dates;
}

async function userToday(userId: string): Promise<string> {
  const { rows } = await pool.query<{ timezone: string }>(
    'SELECT timezone FROM profiles WHERE user_id = $1',
    [userId],
  );
  return todayIn(rows[0]?.timezone ?? 'Europe/Warsaw');
}

async function exerciseMap(): Promise<Map<string, Exercise>> {
  return new Map((await loadExercises()).map((e) => [e.slug, e]));
}

function knownMaxes(card: AthleteCard, available: Exercise[]): Record<string, number> {
  const lifts = card.strength?.lifts ?? {};
  const result: Record<string, number> = {};
  for (const e of available) {
    const lift = lifts[e.slug];
    if (lift) result[e.slug] = lift.oneRmKg;
  }
  return result;
}

async function assertAiQuota(userId: string, today: string): Promise<void> {
  const { rows } = await pool.query<{ requests: number }>(
    `SELECT requests FROM ai_usage WHERE user_id = $1 AND date = $2 AND kind = 'plan'`,
    [userId, today],
  );
  if ((rows[0]?.requests ?? 0) >= config.AI_DAILY_LIMIT) {
    throw new AppError(
      429,
      'RATE_LIMITED',
      `На сегодня лимит построений плана исчерпан (${config.AI_DAILY_LIMIT}). Завтра снова.`,
    );
  }
}

async function recordAiUsage(userId: string, today: string, tokens: number): Promise<void> {
  await pool.query(
    `INSERT INTO ai_usage (user_id, date, kind, requests, tokens) VALUES ($1, $2, 'plan', 1, $3)
     ON CONFLICT (user_id, date, kind)
     DO UPDATE SET requests = ai_usage.requests + 1, tokens = ai_usage.tokens + EXCLUDED.tokens`,
    [userId, today, tokens],
  );
}
