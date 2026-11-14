import type {
  PlannedSession,
  ProgressDay,
  ProgressResponse,
  RecordView,
  StrengthSeries,
  TestResult,
} from '@trektren/shared';
import { addDays, diffDays } from '../../dates.js';
import { pool } from '../../db.js';
import { getCard } from '../card/service.js';
import { loadExercises } from '../exercises/repo.js';
import { ANCHORS } from '../strength/estimate.js';
import { userToday } from '../strength/service.js';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Средняя утреннего веса за 7 дней по дате, если в окне 3+ взвешивания. */
export function movingAverage(morning: Map<string, number>, date: string): number | null {
  const vals: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    const v = morning.get(addDays(date, -i));
    if (v !== undefined) vals.push(v);
  }
  return vals.length >= 3 ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

/** Всё для графиков «Прогресса»: вес, шаги, еда, сон, силовые и рекорды за период. */
export async function getProgress(userId: string, days: number): Promise<ProgressResponse> {
  const to = await userToday(userId);
  const from = addDays(to, -(days - 1));
  const [{ card }, all, weights, steps, meals, wellbeing, sets, tests, records, sessions] =
    await Promise.all([
      getCard(userId),
      loadExercises(),
      pool.query<{ date: string; time_of_day: string; weight_kg: number }>(
        `SELECT date, time_of_day, weight_kg FROM weight_logs WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
        [userId, addDays(from, -6), to],
      ),
      pool.query<{ date: string; steps: number }>(
        'SELECT date, steps FROM step_logs WHERE user_id = $1 AND date BETWEEN $2 AND $3',
        [userId, from, to],
      ),
      pool.query<{ date: string; kcal: number; protein: number }>(
        `SELECT date, sum(kcal)::float AS kcal, sum(protein_g)::float AS protein FROM meals
         WHERE user_id = $1 AND date BETWEEN $2 AND $3 GROUP BY date`,
        [userId, from, to],
      ),
      pool.query<{ date: string; sleep_hours: number | null; wellbeing_score: number | null }>(
        `SELECT date, sleep_hours, wellbeing_score FROM wellbeing_logs WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
        [userId, from, to],
      ),
      pool.query<{ slug: string; date: string; best: number }>(
        `SELECT e.slug, w.date, max(ws.est_1rm)::float AS best
         FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id JOIN exercises e ON e.id = ws.exercise_id
         WHERE w.user_id = $1 AND w.date BETWEEN $2 AND $3 AND ws.est_1rm > 0
         GROUP BY e.slug, w.date`,
        [userId, from, to],
      ),
      pool.query<{ date: string; result_json: TestResult }>(
        `SELECT date, result_json FROM scheduled_sessions
         WHERE user_id = $1 AND result_json IS NOT NULL AND date BETWEEN $2 AND $3`,
        [userId, from, to],
      ),
      pool.query<{
        slug: string;
        name: string;
        date: string;
        weight_kg: number;
        reps: number;
        est_1rm: number;
      }>(
        `SELECT e.slug, e.name_ru AS name, pr.date, pr.weight_kg, pr.reps, pr.est_1rm
         FROM personal_records pr JOIN exercises e ON e.id = pr.exercise_id
         WHERE pr.user_id = $1 ORDER BY pr.date DESC, pr.est_1rm DESC LIMIT 30`,
        [userId],
      ),
      pool.query<{ date: string; planned_json: PlannedSession; done: boolean }>(
        `SELECT s.date, s.planned_json,
                EXISTS (SELECT 1 FROM workouts w WHERE w.session_id = s.id AND w.finished_at IS NOT NULL)
                  OR s.result_json IS NOT NULL AS done
         FROM scheduled_sessions s
         WHERE s.user_id = $1 AND s.date BETWEEN $2 AND $3`,
        [userId, from, to],
      ),
    ]);

  const morning = new Map<string, number>();
  const evening = new Map<string, number>();
  for (const w of weights.rows)
    (w.time_of_day === 'morning' ? morning : evening).set(w.date, w.weight_kg);
  const stepsBy = new Map(steps.rows.map((r) => [r.date, r.steps]));
  const mealsBy = new Map(meals.rows.map((r) => [r.date, r]));
  const wellBy = new Map(wellbeing.rows.map((r) => [r.date, r]));

  const list: ProgressDay[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(from, i);
    const meal = mealsBy.get(date);
    const well = wellBy.get(date);
    list.push({
      date,
      morning: morning.get(date) ?? null,
      evening: evening.get(date) ?? null,
      avg7: movingAverage(morning, date),
      steps: stepsBy.get(date) ?? null,
      kcal: meal ? Math.round(meal.kcal) : null,
      proteinG: meal ? r1(meal.protein) : null,
      sleepHours: well?.sleep_hours ?? null,
      wellbeing: well?.wellbeing_score ?? null,
    });
  }

  const names = new Map(all.map((e) => [e.slug, e.name]));
  const lifts = card.strength?.lifts ?? {};
  const targets = card.strength?.targets ?? {};
  const slugs = [
    ...ANCHORS.filter((a) => lifts[a] || targets[a] || sets.rows.some((r) => r.slug === a)),
  ];
  const strength: StrengthSeries[] = slugs.map((slug) => {
    const points = new Map<string, number>();
    const put = (date: string, kg: number) => {
      if (date < from || date > to) return;
      points.set(date, Math.max(points.get(date) ?? 0, r1(kg)));
    };
    const lift = lifts[slug];
    if (lift?.testedAt) put(lift.testedAt, lift.testedKg!);
    for (const r of sets.rows.filter((x) => x.slug === slug)) put(r.date, r.best);
    for (const t of tests.rows) {
      const l = t.result_json.lifts.find((x) => x.slug === slug);
      if (l) put(t.date, l.oneRmKg);
    }
    return {
      slug,
      name: names.get(slug) ?? slug,
      points: [...points.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, e1rm]) => ({ date, e1rm })),
      currentKg: lift?.oneRmKg ?? null,
      goalKg: targets[slug] ?? null,
    };
  });

  const recordsView: RecordView[] = records.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    date: r.date,
    weightKg: r.weight_kg,
    reps: r.reps,
    e1rm: r.est_1rm,
  }));

  const active = sessions.rows.filter(
    (s) =>
      s.planned_json.exercises.length > 0 && s.date <= to && s.planned_json.phase !== 'after_block',
  );
  return {
    from,
    to,
    days: list,
    strength,
    records: recordsView,
    workouts: {
      planned: active.length,
      done: active.filter((s) => s.done).length,
      missed: active.filter((s) => !s.done && diffDays(s.date, to) > 0).length,
    },
  };
}
