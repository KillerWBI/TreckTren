import { z } from 'zod';
import {
  epleyOneRm,
  round1,
  type ExerciseVerdict,
  type PlannedSession,
  type StartWorkout,
  type WorkoutAnalysis,
  type WorkoutResponse,
  type WorkoutSetInput,
  type WorkoutSetView,
} from '@trektren/shared';
import type { AiProvider } from '../../ai/client.js';
import { config } from '../../config.js';
import { pool, withTransaction } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { getCard } from '../card/service.js';
import { loadExercises } from '../exercises/repo.js';
import { loadContext, SESSION_SELECT, toSessionView, type SessionRow } from '../plan/service.js';
import { userToday, writeStrength } from '../strength/service.js';
import { analyzeWorkout } from './analysis.js';

interface WorkoutRow {
  id: string;
  session_id: string | null;
  date: string;
  readiness: number | null;
  started_at: Date;
  finished_at: Date | null;
  notes: string | null;
  analysis_json: WorkoutAnalysis | null;
}

interface SetRow {
  slug: string;
  set_no: number;
  weight_kg: number;
  reps: number;
  rir: number | null;
  est_1rm: number | null;
}

const est = (weightKg: number, reps: number, rir: number) =>
  round1(epleyOneRm(weightKg, reps + rir));

export async function startWorkout(userId: string, input: StartWorkout): Promise<WorkoutResponse> {
  const today = await userToday(userId);
  if (input.sessionId) {
    const { rows } = await pool.query<{ id: string; planned_json: PlannedSession }>(
      'SELECT id, planned_json FROM scheduled_sessions WHERE id = $1 AND user_id = $2',
      [input.sessionId, userId],
    );
    const session = rows[0];
    if (!session) throw notFound('Тренировка не найдена');
    if (session.planned_json.phase === 'test') {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Проходка записывается в плане, отдельной формой',
      );
    }
    if (session.planned_json.exercises.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'В этот день упражнений нет — перестрой план');
    }
  }

  const id = await withTransaction(async (c) => {
    if (input.sessionId) {
      const existing = await c.query<{ id: string }>(
        'SELECT id FROM workouts WHERE session_id = $1 AND user_id = $2',
        [input.sessionId, userId],
      );
      if (existing.rows[0]) {
        if (input.readiness) {
          await c.query(
            'UPDATE workouts SET readiness = $2 WHERE id = $1 AND finished_at IS NULL',
            [existing.rows[0].id, input.readiness],
          );
        }
        return existing.rows[0].id;
      }
    }
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO workouts (user_id, session_id, date, readiness) VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, input.sessionId ?? null, today, input.readiness ?? null],
    );
    return rows[0]!.id;
  });
  return getWorkout(userId, id);
}

export async function getWorkout(userId: string, id: string): Promise<WorkoutResponse> {
  const workout = await workoutRow(userId, id);
  const [{ rows: sets }, ctx, today] = await Promise.all([
    pool.query<SetRow>(
      `SELECT e.slug, ws.set_no, ws.weight_kg, ws.reps, ws.rir, ws.est_1rm
       FROM workout_sets ws JOIN exercises e ON e.id = ws.exercise_id
       WHERE ws.workout_id = $1 ORDER BY ws.id`,
      [id],
    ),
    loadContext(userId),
    userToday(userId),
  ]);
  let session = null;
  if (workout.session_id) {
    const { rows } = await pool.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = $1`, [
      workout.session_id,
    ]);
    if (rows[0]) session = toSessionView(rows[0], ctx, today);
  }
  return {
    workout: {
      id: workout.id,
      sessionId: workout.session_id,
      date: workout.date,
      readiness: workout.readiness,
      startedAt: workout.started_at.toISOString(),
      finishedAt: workout.finished_at?.toISOString() ?? null,
      notes: workout.notes,
      sets: sets.map(toSetView),
      analysis: workout.analysis_json,
    },
    session,
  };
}

function toSetView(r: SetRow): WorkoutSetView {
  return {
    exerciseSlug: r.slug,
    setNo: r.set_no,
    weightKg: r.weight_kg,
    reps: r.reps,
    rir: r.rir ?? 0,
    est1rm: r.est_1rm ?? est(r.weight_kg, r.reps, r.rir ?? 0),
  };
}

async function workoutRow(userId: string, id: string): Promise<WorkoutRow> {
  if (!z.uuid().safeParse(id).success) throw notFound('Тренировка не найдена');
  const { rows } = await pool.query<WorkoutRow>(
    `SELECT id, session_id, date, readiness, started_at, finished_at, notes, analysis_json
     FROM workouts WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!rows[0]) throw notFound('Тренировка не найдена');
  return rows[0];
}

async function openWorkout(userId: string, id: string): Promise<WorkoutRow> {
  const workout = await workoutRow(userId, id);
  if (workout.finished_at) {
    throw new AppError(409, 'VERSION_CONFLICT', 'Тренировка уже завершена, разбор готов');
  }
  return workout;
}

/** Подход сохраняется сразу: в зале связь бывает плохой, а записанное не должно теряться. */
export async function saveSet(userId: string, id: string, input: WorkoutSetInput) {
  await openWorkout(userId, id);
  const exercise = (await loadExercises()).find((e) => e.slug === input.exerciseSlug);
  if (!exercise) throw new AppError(400, 'VALIDATION_ERROR', 'Такого упражнения нет в базе');
  const e1rm =
    input.weightKg > 0 && input.reps > 0 ? est(input.weightKg, input.reps, input.rir) : 0;
  await pool.query(
    `INSERT INTO workout_sets (workout_id, exercise_id, set_no, weight_kg, reps, rir, est_1rm)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (workout_id, exercise_id, set_no)
     DO UPDATE SET weight_kg = EXCLUDED.weight_kg, reps = EXCLUDED.reps, rir = EXCLUDED.rir,
                   est_1rm = EXCLUDED.est_1rm`,
    [id, exercise.id, input.setNo, input.weightKg, input.reps, input.rir, e1rm],
  );
  return { ...input, est1rm: e1rm };
}

export async function deleteSet(userId: string, id: string, slug: string, setNo: number) {
  await openWorkout(userId, id);
  await pool.query(
    `DELETE FROM workout_sets ws USING exercises e
     WHERE ws.exercise_id = e.id AND ws.workout_id = $1 AND e.slug = $2 AND ws.set_no = $3`,
    [id, slug, setNo],
  );
}

/**
 * Завершение: разбор по упражнениям, новые максимумы в «Силовые» (веса будущих тренировок
 * пересчитаются сами), рекорды, облегчение следующей тренировки, если эта далась тяжело.
 */
export async function finishWorkout(
  userId: string,
  id: string,
  notes: string | undefined,
  ai: AiProvider,
): Promise<WorkoutResponse> {
  const workout = await openWorkout(userId, id);
  const current = await getWorkout(userId, id);
  const sets = current.workout.sets;
  if (sets.filter((s) => s.reps > 0).length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Не записано ни одного подхода');
  }

  const [ctx, previous, bestEver, { card }] = await Promise.all([
    loadContext(userId),
    previousVerdicts(userId, id),
    bestRecords(userId),
    getCard(userId),
  ]);
  const result = analyzeWorkout({
    planned: current.session?.exercises ?? [],
    sets,
    exercises: ctx.exercises,
    maxes: ctx.maxes,
    previous,
    bestEver,
    readiness: workout.readiness,
  });

  const nextChanges: string[] = [];
  for (const change of result.maxChanges) {
    const name = ctx.exercises.get(change.slug)?.name ?? change.slug;
    const before = ctx.maxes.get(change.slug);
    nextChanges.push(
      before?.basis === 'own'
        ? `${name}: максимум ${fmt(before.oneRmKg)} → ${fmt(change.oneRmKg)} кг, веса на следующих тренировках ${change.oneRmKg > before.oneRmKg ? 'выше' : 'ниже'}.`
        : `${name}: теперь в плане вес по твоим подходам.`,
    );
  }
  if (result.maxChanges.length > 0) {
    await writeStrength(userId, card, {
      lifts: result.maxChanges.map((c) => ({
        slug: c.slug,
        working: c.working,
        oneRmKg: c.oneRmKg,
      })),
      source: 'log',
      cardSource: 'user',
      reason: `Тренировка ${workout.date}`,
    });
  }

  if (result.hard && current.session) {
    const eased = await easeNextSession(userId, current.session.date, current.session.id);
    if (eased) nextChanges.push(`Следующая тренировка (${eased}) облегчена: веса −5%, запас +1.`);
  }

  const coachNote = ai.enabled
    ? await aiCoachNote(userId, ai, result.summary, result.exercises)
    : null;
  const analysis: WorkoutAnalysis = {
    exercises: result.exercises,
    summary: result.summary,
    coachNote,
    nextChanges,
  };

  await withTransaction(async (c) => {
    for (const r of result.records) {
      const exerciseId = ctx.exercises.get(r.slug)?.id;
      if (!exerciseId) continue;
      await c.query(
        `INSERT INTO personal_records (user_id, exercise_id, weight_kg, reps, est_1rm, date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, exerciseId, r.set.weightKg, r.set.reps, r.set.est1rm, workout.date],
      );
    }
    await c.query(
      `UPDATE workouts SET finished_at = now(), notes = $2, analysis_json = $3 WHERE id = $1`,
      [id, notes ?? null, JSON.stringify(analysis)],
    );
    if (workout.session_id) {
      await c.query(`UPDATE scheduled_sessions SET status = 'done' WHERE id = $1`, [
        workout.session_id,
      ]);
    }
  });
  return getWorkout(userId, id);
}

const fmt = (n: number) => String(round1(n)).replace('.', ',');

/** Вердикты прошлых тренировок: «дважды подряд тяжело» считается по ним. */
async function previousVerdicts(userId: string, exceptId: string) {
  const { rows } = await pool.query<{ analysis_json: WorkoutAnalysis }>(
    `SELECT analysis_json FROM workouts
     WHERE user_id = $1 AND id <> $2 AND finished_at IS NOT NULL AND analysis_json IS NOT NULL
     ORDER BY finished_at DESC LIMIT 10`,
    [userId, exceptId],
  );
  const map = new Map<string, ExerciseVerdict>();
  for (const r of rows) {
    for (const e of r.analysis_json.exercises) {
      if (!map.has(e.slug) && e.verdict !== 'skipped') map.set(e.slug, e.verdict);
    }
  }
  return map;
}

async function bestRecords(userId: string) {
  const { rows } = await pool.query<{ slug: string; best: number }>(
    `SELECT e.slug, max(pr.est_1rm) AS best FROM personal_records pr
     JOIN exercises e ON e.id = pr.exercise_id WHERE pr.user_id = $1 GROUP BY e.slug`,
    [userId],
  );
  return new Map(rows.map((r) => [r.slug, Number(r.best)]));
}

/** Следующая запланированная тренировка того же блока: −5% к весам и +1 к запасу. */
async function easeNextSession(userId: string, afterDate: string, sessionId: string) {
  const { rows } = await pool.query<{ id: string; date: string; planned_json: PlannedSession }>(
    `SELECT s.id, s.date, s.planned_json FROM scheduled_sessions s
     WHERE s.user_id = $1 AND s.id <> $3 AND s.date >= $2 AND s.status = 'planned'
       AND s.block_id = (SELECT block_id FROM scheduled_sessions WHERE id = $3)
       AND NOT EXISTS (SELECT 1 FROM workouts w WHERE w.session_id = s.id)
     ORDER BY s.date LIMIT 1`,
    [userId, afterDate, sessionId],
  );
  const next = rows[0];
  if (
    !next ||
    next.planned_json.phase !== 'accumulation' ||
    next.planned_json.exercises.length === 0
  ) {
    return null;
  }
  const planned: PlannedSession = {
    ...next.planned_json,
    adjustments: [
      ...next.planned_json.adjustments,
      'Прошлая тренировка далась тяжело: веса −5%, запас на 1 больше.',
    ],
    exercises: next.planned_json.exercises.map((x) => ({
      ...x,
      loadFactor: round2(x.loadFactor * 0.95),
      rir: Math.min(4, x.rir + 1),
    })),
  };
  await pool.query('UPDATE scheduled_sessions SET planned_json = $2 WHERE id = $1', [
    next.id,
    JSON.stringify(planned),
  ]);
  return next.date;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const noteSchema = z.object({ note: z.string().min(1).max(500) });

/** Короткий разбор от ИИ. Не ответил — не страшно: разбор по правилам уже есть. */
async function aiCoachNote(
  userId: string,
  ai: AiProvider,
  summary: string,
  exercises: WorkoutAnalysis['exercises'],
): Promise<string | null> {
  const today = await userToday(userId);
  const { rows } = await pool.query<{ requests: number }>(
    `SELECT requests FROM ai_usage WHERE user_id = $1 AND date = $2 AND kind = 'workout'`,
    [userId, today],
  );
  if ((rows[0]?.requests ?? 0) >= config.AI_DAILY_LIMIT) return null;
  try {
    const result = await ai.generateJson({
      name: 'workout_note',
      task: 'note',
      schema: noteSchema,
      maxTokens: 4000,
      messages: [
        {
          role: 'system',
          content:
            'Ты строгий тренер. По разбору тренировки напиши 2–3 коротких предложения человеку: главное, что получилось, что нет, и что сделать на следующей. Без похвалы ради похвалы, без английских сокращений, на русском. Ответ — JSON {"note": "..."}.',
        },
        {
          role: 'user',
          content: `${summary}\n${exercises.map((e) => `${e.name}: ${e.text}`).join('\n')}`,
        },
      ],
      validate: (raw) => {
        const r = noteSchema.safeParse(raw);
        return r.success ? { ok: true, value: r.data } : { ok: false, errors: ['нужно поле note'] };
      },
    });
    await pool.query(
      `INSERT INTO ai_usage (user_id, date, kind, requests, tokens) VALUES ($1, $2, 'workout', 1, $3)
       ON CONFLICT (user_id, date, kind)
       DO UPDATE SET requests = ai_usage.requests + 1, tokens = ai_usage.tokens + EXCLUDED.tokens`,
      [userId, today, result.tokens],
    );
    return result.value.note;
  } catch (err) {
    console.warn(`[ai] разбор тренировки без ИИ: ${(err as Error).message}`);
    return null;
  }
}
