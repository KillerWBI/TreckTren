import { Router } from 'express';
import {
  diagnosticResultsSchema,
  type AthleteCard,
  type DiagnosticCheck,
  type DiagnosticsResponse,
} from '@trektren/shared';
import { pool } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { requireAuth, userIdOf } from '../../middleware/auth.js';
import { parseBody } from '../../validate.js';
import { applyCardPatch, getCard } from '../card/service.js';
import { loadExercises } from '../exercises/repo.js';
import { analyzeBalance, PROTOCOLS } from './balance.js';
import { ANCHORS } from './estimate.js';
import { userToday } from './service.js';

/** Причина в «Слабых местах» карточки: так тренер видит её при следующем построении плана. */
export const DIAGNOSTIC_REASON = 'Проверка слабого места';

interface DiagnosticRow {
  trigger: string;
  results: { values: Record<string, number>; conclusions: string[] } | null;
  conclusion: string | null;
  created_at: Date;
}

function ownMaxes(card: AthleteCard): Record<string, number> {
  return Object.fromEntries(
    Object.entries(card.strength?.lifts ?? {}).map(([slug, l]) => [slug, l.oneRmKg]),
  );
}

export async function getDiagnostics(userId: string): Promise<DiagnosticsResponse> {
  const [{ card }, all, { rows }] = await Promise.all([
    getCard(userId),
    loadExercises(),
    pool.query<DiagnosticRow>(
      `SELECT DISTINCT ON (trigger) trigger, results, conclusion, created_at
       FROM diagnostics WHERE user_id = $1 AND status = 'done'
       ORDER BY trigger, created_at DESC`,
      [userId],
    ),
  ]);
  const exercises = new Map(all.map((e) => [e.slug, e]));
  const findings = analyzeBalance(card, exercises);
  const maxes = ownMaxes(card);
  const last = new Map(rows.map((r) => [r.trigger, r]));

  const checks: DiagnosticCheck[] = findings.map((finding) => {
    const row = last.get(finding.id);
    return {
      finding,
      tests: PROTOCOLS[finding.id]?.tests(maxes) ?? [],
      last: row
        ? {
            date: row.created_at.toISOString().slice(0, 10),
            results: row.results?.values ?? {},
            conclusions: row.results?.conclusions ?? [],
            summary: row.conclusion ?? '',
          }
        : null,
    };
  });

  let note: string | null = null;
  if (checks.length === 0) {
    const known = ANCHORS.filter((a) => maxes[a]).length;
    note =
      known < 2
        ? 'Впиши максимумы хотя бы в двух базовых — тренер сравнит их и найдёт, что отстаёт.'
        : 'Соотношения в норме: явно отстающих движений нет.';
  }
  return { checks, note };
}

/** Результаты тестов → вывод → слабое место в карточке. */
export async function submitDiagnostic(
  userId: string,
  findingId: string,
  values: Record<string, number>,
): Promise<DiagnosticsResponse> {
  const [{ card }, all] = await Promise.all([getCard(userId), loadExercises()]);
  const exercises = new Map(all.map((e) => [e.slug, e]));
  const finding = analyzeBalance(card, exercises).find((f) => f.id === findingId);
  const protocol = PROTOCOLS[findingId];
  if (!finding || !protocol) throw notFound('Такого отставания сейчас нет — обнови страницу');

  const maxes = ownMaxes(card);
  const allowed = new Set(protocol.tests(maxes).map((t) => t.id));
  const clean = Object.fromEntries(Object.entries(values).filter(([k]) => allowed.has(k)));
  if (Object.keys(clean).length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Впиши результат хотя бы одного теста');
  }

  const conclusions = protocol.conclude(clean, maxes);
  const problems = conclusions.filter((c) => c.problem).map((c) => c.text);
  const summary = problems.length > 0 ? problems.join(' ') : protocol.fallback;
  const today = await userToday(userId);

  await pool.query(
    `INSERT INTO diagnostics (user_id, trigger, exercise_id, tests, results, conclusion, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'done')`,
    [
      userId,
      findingId,
      exercises.get(finding.lagging)?.id ?? null,
      JSON.stringify(protocol.tests(maxes)),
      JSON.stringify({ values: clean, conclusions: conclusions.map((c) => c.text) }),
      summary,
    ],
  );
  await saveWeakPoint(userId, card, finding.laggingName, findingId, summary, today);
  return getDiagnostics(userId);
}

/** Слабые места — массив: merge patch заменяет его целиком, поэтому собираем новый список. */
async function saveWeakPoint(
  userId: string,
  card: AthleteCard,
  area: string,
  findingId: string,
  cause: string,
  today: string,
) {
  const list = [...(card.weakPoints ?? [])];
  const id = `diag-${findingId}`;
  const lower = area.toLowerCase();
  const index = list.findIndex(
    (w) =>
      w.id === id || w.area.toLowerCase().includes(lower) || lower.includes(w.area.toLowerCase()),
  );
  const entry = {
    id: index === -1 ? id : list[index]!.id,
    area: index === -1 ? area : list[index]!.area,
    cause: cause.slice(0, 2000),
    status: 'confirmed' as const,
    source: 'ai' as const,
    updatedAt: today,
  };
  if (index === -1) list.push(entry);
  else list[index] = entry;
  await applyCardPatch(
    userId,
    { weakPoints: list.slice(0, 20) },
    { source: 'ai', reason: `${DIAGNOSTIC_REASON}: ${area}`, allowedSections: ['weakPoints'] },
  );
}

export const diagnosticsRouter = Router();

diagnosticsRouter.get('/diagnostics', requireAuth, async (req, res) => {
  res.json(await getDiagnostics(userIdOf(req)));
});

diagnosticsRouter.post('/diagnostics/:findingId', requireAuth, async (req, res) => {
  const findingId = String(req.params.findingId);
  if (!/^[a-z-]{1,40}$/.test(findingId)) throw notFound('Такого отставания нет');
  const body = parseBody(diagnosticResultsSchema, req.body);
  res.json(await submitDiagnostic(userIdOf(req), findingId, body.results));
});
