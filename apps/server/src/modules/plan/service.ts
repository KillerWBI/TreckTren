import type { PoolClient } from 'pg';
import {
  blockTemplateSchema,
  isSectionFilled,
  REQUIRED_CARD_SECTIONS,
  type AthleteCard,
  type BlockTemplate,
  type BlockView,
  type GeneratePlanRequest,
  type PlannedSession,
  type PlanResponse,
  type PlanSource,
  type LiftForecast,
  type SessionView,
  type TestLiftResult,
  type TestResult,
  type TestResultRequest,
  type TestVerdict,
  type TextFacts,
  epleyOneRm,
  round1,
} from '@trektren/shared';
import { AiError, type AiProvider } from '../../ai/client.js';
import { config } from '../../config.js';
import { addDays, uniqueSorted } from '../../dates.js';
import { pool, withTransaction } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { getCard } from '../card/service.js';
import { loadExercises, type Exercise } from '../exercises/repo.js';
import { analyzeBalance } from '../strength/balance.js';
import { DIAGNOSTIC_REASON } from '../strength/diagnostics.js';
import { estimateMaxes, type MaxEstimate } from '../strength/estimate.js';
import { forecastBlock } from '../strength/forecast.js';
import { userToday, writeStrength } from '../strength/service.js';
import { filterAvailable } from './availability.js';
import { deloadWeekStart, layoutSessions, type LaidOutSession } from './layout.js';
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
  factsNote?: string | null;
  forecast?: LiftForecast[];
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
  result_json: TestResult | null;
}

export async function getPlan(userId: string, ai: AiProvider): Promise<PlanResponse> {
  const aiStatus = { enabled: ai.enabled, model: ai.model };
  const block = await activeBlock(pool, userId);
  if (!block) return { block: null, sessions: [], ai: aiStatus };

  const [{ rows }, { card }, all, staleSections] = await Promise.all([
    pool.query<SessionRow>(
      'SELECT id, date, status, planned_json, result_json FROM scheduled_sessions WHERE block_id = $1 ORDER BY date',
      [block.id],
    ),
    getCard(userId),
    loadExercises(),
    changedSince(userId, block.created_at),
  ]);
  const exercises = new Map(all.map((e) => [e.slug, e]));
  // Веса считаются при каждом чтении от текущей карточки: поменял максимум — план уже другой.
  const maxes = estimateMaxes(card, all);
  const dumbbellMaxKg = card.equipment?.dumbbellMaxKg;

  const sessions: SessionView[] = rows.map((r) => ({
    id: r.id,
    date: r.date,
    status: r.status,
    result: r.result_json,
    ...r.planned_json,
    exercises: r.planned_json.exercises.map((x) => {
      const exercise = exercises.get(x.slug);
      return {
        ...x,
        name: exercise?.name ?? x.slug,
        load: loadFor(x, exercise, maxes.get(x.slug), { dumbbellMaxKg }),
      };
    }),
  }));
  const testDate = sessions.find((x) => x.phase === 'test')?.date ?? null;
  return { block: toBlockView(block, staleSections, testDate), sessions, ai: aiStatus };
}

/** Разделы карточки, которые человек поменял после построения плана. Силовые не в счёт: веса пересчитываются сами. */
async function changedSince(userId: string, since: Date): Promise<string[]> {
  const { rows } = await pool.query<{ patch: Record<string, unknown> }>(
    `SELECT patch FROM card_versions
     WHERE user_id = $1 AND created_at > $2 AND (source = 'user' OR reason LIKE $3)`,
    [userId, since, `${DIAGNOSTIC_REASON}%`],
  );
  const sections = new Set(rows.flatMap((r) => Object.keys(r.patch)));
  sections.delete('strength');
  return [...sections];
}

export async function generatePlan(
  userId: string,
  request: GeneratePlanRequest,
  ai: AiProvider,
): Promise<PlanResponse> {
  const today = await userToday(userId);
  const dates = checkDates(request.dates, today);
  let { card } = await getCard(userId);

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
          maxes: anchorMaxes(card, all),
          findings: analyzeBalance(card, new Map(all.map((e) => [e.slug, e]))),
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

  // Цифры из текста анкеты и комментария — в «Силовые», чтобы дальше они были данными, а не догадкой.
  let factsNote: string | null = null;
  if (template.fromText) {
    const applied = await applyTextFacts(userId, card, template.fromText, all);
    if (applied) {
      card = applied.card;
      factsNote = applied.note;
    }
    delete template.fromText;
  }
  if (source === 'rules' && comment && !generationNote) {
    generationNote =
      'Комментарий учтёт ИИ, когда он будет подключён: по правилам план строится без комментариев.';
  }

  const exercises = new Map(all.map((e) => [e.slug, e]));
  const forecast = forecastBlock({
    card,
    template,
    maxes: estimateMaxes(card, all),
    exercises,
    findings: analyzeBalance(card, exercises),
    today,
  });
  const laid = layoutSessions(template, dates, exercises, dates[0], testLifts(forecast));
  const stored: StoredPlan = {
    template,
    source,
    model,
    comment,
    generationNote,
    excluded: excluded.map((e) => e.name),
    factsNote,
    forecast,
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
    const laid = layoutSessions(
      block.plan_json.template,
      dates,
      exercises,
      start,
      testLifts(block.plan_json.forecast ?? []),
    ).filter((s) => s.date >= today);

    await c.query(
      `DELETE FROM scheduled_sessions WHERE block_id = $1 AND status = 'planned' AND date >= $2`,
      [block.id, today],
    );
    await c.query('UPDATE training_blocks SET start_date = $2 WHERE id = $1', [block.id, start]);
    await insertSessions(c, userId, block.id, laid);
  });
  return getPlan(userId, ai);
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

function toBlockView(b: BlockRow, staleSections: string[], testDate: string | null): BlockView {
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
    factsNote: p.factsNote ?? null,
    staleSections,
    forecast: p.forecast ?? [],
    testDate,
    testFrom: deloadWeekStart(p.template, b.start_date),
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

async function exerciseMap(): Promise<Map<string, Exercise>> {
  return new Map((await loadExercises()).map((e) => [e.slug, e]));
}

/** Максимумы опорных движений для промпта: свои и посчитанные, с пометкой откуда. */
function anchorMaxes(card: AthleteCard, all: Exercise[]): Array<{ slug: string } & MaxEstimate> {
  const maxes = estimateMaxes(card, all);
  return ['barbell-back-squat', 'deadlift', 'bench-press', 'overhead-press', 'barbell-row'].flatMap(
    (slug) => {
      const m = maxes.get(slug);
      return m ? [{ slug, ...m }] : [];
    },
  );
}

/**
 * Пишет в карточку цифры, которые ИИ нашёл в тексте. Только туда, где у человека ещё пусто:
 * то, что он ввёл в «Силовые» сам, не перезаписываем.
 */
async function applyTextFacts(
  userId: string,
  card: AthleteCard,
  facts: TextFacts,
  all: Exercise[],
) {
  const names = new Map(all.map((e) => [e.slug, e]));
  const lifts: Array<{
    slug: string;
    testedKg?: number;
    working?: { weightKg: number; reps: number; rir: number };
  }> = [];
  const targets: Record<string, number> = {};
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const f of facts.lifts ?? []) {
    const exercise = names.get(f.slug);
    if (!exercise || exercise.bodyweight || seen.has(`${f.slug}:${f.kind}`)) continue;
    seen.add(`${f.slug}:${f.kind}`);
    const current = card.strength?.lifts?.[f.slug];
    const reps = f.reps ?? 1;
    if (f.kind === 'max' && reps === 1) {
      if (current?.testedKg) continue;
      lifts.push({ slug: f.slug, testedKg: f.weightKg });
      notes.push(`${exercise.name.toLowerCase()} — максимум ${f.weightKg} кг`);
    } else {
      if (current?.working || current?.testedKg) continue;
      const rir = f.rir ?? (f.kind === 'max' ? 0 : 2);
      lifts.push({ slug: f.slug, working: { weightKg: f.weightKg, reps, rir } });
      notes.push(`${exercise.name.toLowerCase()} — ${f.weightKg} кг × ${reps}`);
    }
  }
  for (const t of facts.targets ?? []) {
    const exercise = names.get(t.slug);
    if (!exercise || card.strength?.targets?.[t.slug] || targets[t.slug]) continue;
    targets[t.slug] = t.weightKg;
    notes.push(`цель: ${exercise.name.toLowerCase()} ${t.weightKg} кг`);
  }
  if (notes.length === 0) return null;

  const result = await writeStrength(userId, card, {
    lifts,
    targets,
    source: 'text',
    cardSource: 'ai',
    reason: 'ИИ взял цифры из анкеты и комментария',
  });
  if (!result) return null;
  return {
    card: result.card,
    note: `Взял из твоих записей и сохранил в «Силовые»: ${notes.join('; ')}.`,
  };
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

const testLifts = (forecast: LiftForecast[]) =>
  forecast.map((f) => ({ slug: f.slug, targetKg: f.targetKg }));

const kg = (n: number) => String(round1(n)).replace('.', ',');

function verdictFor(oneRm: number, startKg: number, targetKg: number): TestVerdict {
  if (oneRm >= targetKg) return 'above';
  if (oneRm >= targetKg - 2.5) return 'near';
  if (oneRm > startKg) return 'below';
  return 'regress';
}

function liftText(r: Omit<TestLiftResult, 'text'>): string {
  const what =
    r.reps === 1 ? `${kg(r.weightKg)} кг` : `${kg(r.weightKg)}×${r.reps} ≈ ${kg(r.oneRmKg)} кг`;
  const head = `${r.name}: ${what}, прогноз ${kg(r.targetKg)}.`;
  switch (r.verdict) {
    case 'above':
      return r.oneRmKg > r.targetKg
        ? `${head} Выше прогноза на ${kg(r.oneRmKg - r.targetKg)} кг — блок сработал, следующий строим от нового максимума.`
        : `${head} Ровно по прогнозу — блок сработал, следующий строим от нового максимума.`;
    case 'near':
      return `${head} Почти: до прогноза ${kg(r.targetKg - r.oneRmKg)} кг. Схема рабочая, продолжаем.`;
    case 'below':
      return `${head} Рост +${kg(r.oneRmKg - r.startKg)} кг, но ниже прогноза на ${kg(r.targetKg - r.oneRmKg)} кг. Проверь сон, пропуски и честность запаса в подходах.`;
    case 'regress':
      return `${head} Не выше старта (${kg(r.startKg)}). Это регресс: сначала сон, питание и пропуски, в следующем блоке меньше объёма и больше техники на этом движении.`;
  }
}

/**
 * Результат проходки: сверка с прогнозом по каждому движению, новые максимумы в карточку,
 * итог и что менять в следующем блоке.
 */
export async function recordTestResult(
  userId: string,
  sessionId: string,
  request: TestResultRequest,
  ai: AiProvider,
): Promise<PlanResponse> {
  const { rows } = await pool.query<SessionRow & { plan_json: StoredPlan }>(
    `SELECT s.id, s.date, s.status, s.planned_json, s.result_json, b.plan_json
     FROM scheduled_sessions s JOIN training_blocks b ON b.id = s.block_id
     WHERE s.id = $1 AND s.user_id = $2 AND b.status = 'active'`,
    [sessionId, userId],
  );
  const session = rows[0];
  if (!session) throw notFound('Тренировка не найдена');
  if (session.planned_json.phase !== 'test') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Результат записывается только для проходки');
  }
  const today = await userToday(userId);
  if (session.date > today) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Проходка ещё впереди — запиши результат в её день',
    );
  }

  const planned = new Map(session.planned_json.exercises.map((x) => [x.slug, x]));
  const forecast = new Map((session.plan_json.forecast ?? []).map((f) => [f.slug, f]));
  const exercises = new Map((await loadExercises()).map((e) => [e.slug, e]));
  const lifts: TestLiftResult[] = request.lifts.map((l) => {
    const p = planned.get(l.slug);
    if (!p) throw new AppError(400, 'VALIDATION_ERROR', `«${l.slug}» нет в этой проходке`);
    const f = forecast.get(l.slug);
    const oneRmKg = round1(epleyOneRm(l.weightKg, l.reps));
    const targetKg = f?.targetKg ?? p.targetKg ?? oneRmKg;
    const startKg = f?.startKg ?? targetKg;
    const base = {
      slug: l.slug,
      name: exercises.get(l.slug)?.name ?? l.slug,
      weightKg: l.weightKg,
      reps: l.reps,
      oneRmKg,
      startKg,
      targetKg,
      verdict: verdictFor(oneRmKg, startKg, targetKg),
    };
    return { ...base, text: liftText(base) };
  });

  const hit = lifts.filter((l) => l.verdict === 'above' || l.verdict === 'near');
  const behind = lifts.filter((l) => l.verdict === 'below' || l.verdict === 'regress');
  const summary = [
    `По прогнозу: ${hit.length} из ${lifts.length}.`,
    behind.length > 0
      ? `Отстаёт: ${behind.map((l) => l.name.toLowerCase()).join(', ')} — в следующем блоке акцент на ${behind.length > 1 ? 'этих движениях' : 'этом движении'}.`
      : 'Все движения растут как надо.',
    'Новые максимумы записаны в «Силовые». Нажми «Перестроить» — следующий блок построится от них.',
  ].join(' ');
  const result: TestResult = { date: today, lifts, summary };

  const { card } = await getCard(userId);
  await writeStrength(userId, card, {
    lifts: lifts.map((l) =>
      l.reps === 1
        ? { slug: l.slug, testedKg: l.weightKg }
        : { slug: l.slug, working: { weightKg: l.weightKg, reps: l.reps, rir: 0 } },
    ),
    source: 'test',
    cardSource: 'user',
    reason: 'Проходка',
  });
  await pool.query(
    `UPDATE scheduled_sessions SET result_json = $2, status = 'done' WHERE id = $1`,
    [sessionId, JSON.stringify(result)],
  );
  return getPlan(userId, ai);
}
