import {
  round1,
  type ExerciseAnalysis,
  type ExerciseVerdict,
  type SessionExerciseView,
  type WorkingSet,
  type WorkoutSetView,
} from '@trektren/shared';
import type { Exercise } from '../exercises/repo.js';
import type { MaxEstimate } from '../strength/estimate.js';

/** Рост рабочего максимума за одну тренировку — не больше 5% (правило ТЗ). */
const MAX_STEP_UP = 0.05;
const STEP_DOWN = 0.05;
/** Все подходы на верх диапазона — шаг вверх поменьше. */
const TOP_STEP = 0.025;

function allTop(done: WorkoutSetView[], plan: SessionExerciseView): boolean {
  if (done.length < plan.sets) return false;
  const avgRir = done.reduce((n, s) => n + s.rir, 0) / done.length;
  return done.every((s) => s.reps >= plan.repsMax) && avgRir >= plan.rir;
}

export interface AnalysisInput {
  planned: SessionExerciseView[];
  sets: WorkoutSetView[];
  exercises: Map<string, Exercise>;
  /** Максимумы до тренировки. */
  maxes: Map<string, MaxEstimate>;
  /** Вердикт по упражнению на прошлой тренировке, где оно было. */
  previous: Map<string, ExerciseVerdict>;
  /** Лучший расчётный максимум за всю историю. */
  bestEver: Map<string, number>;
  readiness: number | null;
}

export interface MaxChange {
  slug: string;
  oneRmKg: number;
  working: WorkingSet;
}

export interface AnalysisResult {
  exercises: ExerciseAnalysis[];
  maxChanges: MaxChange[];
  records: Array<{ slug: string; set: WorkoutSetView }>;
  /** Тренировка далась тяжело: следующую облегчаем. */
  hard: boolean;
  summary: string;
}

const kg = (n: number) => String(round1(n)).replace('.', ',');
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Разбор тренировки по упражнениям: лучший подход против максимума, по которому
 * считались веса. Сильнее — поднимаем максимум (не больше +5%), дважды подряд слабее — снижаем на 5%.
 * Первая запись упражнения задаёт его максимум: дальше веса считаются по твоим подходам.
 */
export function analyzeWorkout(input: AnalysisInput): AnalysisResult {
  const { planned, sets, exercises, maxes, previous, bestEver, readiness } = input;
  const order = [
    ...planned.map((p) => p.slug),
    ...[...new Set(sets.map((s) => s.exerciseSlug))].filter(
      (slug) => !planned.some((p) => p.slug === slug),
    ),
  ];

  const result: AnalysisResult = {
    exercises: [],
    maxChanges: [],
    records: [],
    hard: false,
    summary: '',
  };

  for (const slug of order) {
    const plan = planned.find((p) => p.slug === slug);
    const exercise = exercises.get(slug);
    const name = exercise?.name ?? plan?.name ?? slug;
    const done = sets.filter((s) => s.exerciseSlug === slug && s.reps > 0);
    const plannedSets = plan?.sets ?? 0;
    const base = { slug, name, plannedSets, doneSets: done.length, record: false };

    if (done.length === 0) {
      result.exercises.push({
        ...base,
        verdict: 'skipped',
        text: 'Не сделано. Каждый пропущенный подход — минус к прогрессу, на следующей не пропускай.',
        bestE1rm: null,
        maxBefore: maxes.get(slug)?.oneRmKg ?? null,
        maxAfter: maxes.get(slug)?.oneRmKg ?? null,
      });
      continue;
    }

    const notes: string[] = [];
    if (plan && done.length < plan.sets)
      notes.push(`Сделал ${done.length} из ${plan.sets} подходов.`);
    if (plan) {
      const minRir = Math.min(...done.map((s) => s.rir));
      const avgRir = done.reduce((n, s) => n + s.rir, 0) / done.length;
      if (minRir < plan.rir - 1) {
        notes.push(
          `Запас ${minRir} при плане ${plan.rir}: до отказа рано — так копится усталость, а не сила.`,
        );
      } else if (avgRir > plan.rir + 1.5) {
        notes.push(`Запас ${kg(avgRir)} при плане ${plan.rir}: работал легко — бери тяжелее.`);
      }
    }

    // Упражнения с собственным весом: максимума нет, смотрим на повторы.
    if (exercise?.bodyweight || done.every((s) => s.weightKg === 0)) {
      const reps = done.map((s) => s.reps).join(', ');
      result.exercises.push({
        ...base,
        verdict: 'hold',
        text: [`Повторы: ${reps}.`, ...notes].join(' '),
        bestE1rm: null,
        maxBefore: null,
        maxAfter: null,
      });
      continue;
    }

    const best = done.reduce((a, b) => (b.est1rm > a.est1rm ? b : a));
    const before = maxes.get(slug);
    let verdict: ExerciseVerdict;
    let after = before?.oneRmKg ?? null;
    let head: string;

    if (!before || before.basis !== 'own') {
      verdict = 'first';
      after = round1(best.est1rm);
      head = before
        ? `Первая запись: максимум ≈ ${kg(after)} кг (расчёт был ${kg(before.oneRmKg)}). Дальше веса считаются по твоим подходам.`
        : `Первая запись: максимум ≈ ${kg(after)} кг. Теперь в плане будет вес.`;
    } else {
      const ratio = best.est1rm / before.oneRmKg;
      if (ratio >= 1.025) {
        verdict = 'progress';
        after = round1(Math.min(best.est1rm, before.oneRmKg * (1 + MAX_STEP_UP)));
        head = `Сильнее плана: лучший подход ${kg(best.weightKg)}×${best.reps} ≈ ${kg(best.est1rm)} кг. Максимум ${kg(before.oneRmKg)} → ${kg(after)}${after < best.est1rm ? ' (не больше +5% за раз)' : ''}, следующие веса выше.`;
      } else if (ratio >= 0.95 && plan && allTop(done, plan)) {
        // Двойная прогрессия: все подходы на верх диапазона с нужным запасом — веса вверх.
        verdict = 'progress';
        after = round1(before.oneRmKg * (1 + TOP_STEP));
        head = `Все подходы на верх диапазона с запасом — максимум ${kg(before.oneRmKg)} → ${kg(after)}, следующие веса выше.`;
      } else if (ratio >= 0.95) {
        verdict = 'hold';
        head = `По плану: ≈ ${kg(best.est1rm)} кг при максимуме ${kg(before.oneRmKg)}.`;
      } else {
        const again = previous.get(slug) === 'heavy' || previous.get(slug) === 'under';
        const tired = readiness !== null && readiness <= 2;
        if (again && !tired) {
          verdict = 'under';
          after = round1(before.oneRmKg * (1 - STEP_DOWN));
          head = `Второй раз подряд не дотягиваешь (≈ ${kg(best.est1rm)} при максимуме ${kg(before.oneRmKg)}). Снижаю максимум до ${kg(after)} — веса на 5% легче, техника и запас в порядок.`;
        } else {
          verdict = 'heavy';
          head = `Тяжелее, чем ждали: ≈ ${kg(best.est1rm)} — ${pct(ratio)} от максимума ${kg(before.oneRmKg)}. ${tired ? 'Самочувствие было плохим — веса не трогаю.' : 'Один раз — не повод. Повторится — снижу на 5%.'}`;
        }
      }
    }

    // Рекорд — заметно выше всего, что было: разница в доли килограмма — это погрешность формулы.
    const known = Math.max(bestEver.get(slug) ?? 0, before?.basis === 'own' ? before.oneRmKg : 0);
    const record = verdict !== 'first' && known > 0 && best.est1rm >= known * 1.01;
    if (best.est1rm > (bestEver.get(slug) ?? 0)) result.records.push({ slug, set: best });
    if (
      after !== null &&
      after !== (before?.oneRmKg ?? null) &&
      verdict !== 'hold' &&
      verdict !== 'heavy'
    ) {
      result.maxChanges.push({
        slug,
        oneRmKg: after,
        working: { weightKg: best.weightKg, reps: best.reps, rir: Math.min(best.rir, 5) },
      });
    }
    result.exercises.push({
      ...base,
      verdict,
      record,
      text: [record ? `Рекорд: ≈ ${kg(best.est1rm)} кг.` : '', head, ...notes]
        .filter(Boolean)
        .join(' '),
      bestE1rm: round1(best.est1rm),
      maxBefore: before?.oneRmKg ?? null,
      maxAfter: after,
    });
  }

  const graded = result.exercises.filter((e) => e.verdict !== 'skipped');
  const struggled = result.exercises.filter((e) => e.verdict === 'heavy' || e.verdict === 'under');
  const skipped = result.exercises.filter((e) => e.verdict === 'skipped' && e.plannedSets > 0);
  result.hard =
    (graded.length > 0 && struggled.length * 2 >= graded.length) ||
    (readiness !== null && readiness <= 2);

  const totalSets = sets.filter((s) => s.reps > 0).length;
  const progressed = result.exercises.filter((e) => e.verdict === 'progress').length;
  const parts = [
    `Сделано упражнений: ${graded.length} из ${result.exercises.length}, подходов: ${totalSets}.`,
  ];
  if (progressed > 0) parts.push(`Прогресс: ${progressed}.`);
  if (struggled.length > 0) parts.push(`Тяжело: ${struggled.length}.`);
  if (skipped.length > 0) {
    parts.push(
      `Пропущено: ${skipped.map((e) => e.name.toLowerCase()).join(', ')}. План работает, только если делать его целиком.`,
    );
  }
  if (result.hard) parts.push('Тренировка далась тяжело — следующую облегчаю.');
  result.summary = parts.join(' ');
  return result;
}
