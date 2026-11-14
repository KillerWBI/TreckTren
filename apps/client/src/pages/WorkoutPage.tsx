import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import {
  READINESS_TEXT,
  type ExerciseVerdict,
  type ExerciseView,
  type SessionExerciseView,
  type WorkoutAnalysis,
  type WorkoutResponse,
  type WorkoutSetView,
} from '@trektren/shared';
import { ApiError } from '../api/http';
import { ErrorState, Loading } from '../components/States';
import { num, plural } from '../format';
import { flushOutbox, outboxItems, useOutbox } from '../offline/outbox';
import { shortDay } from '../plan/dates';
import {
  useDeleteSet,
  useExercises,
  useFinishWorkout,
  useSaveSet,
  useStartWorkout,
  useWorkout,
} from '../plan/usePlan';

interface Row {
  weight: string;
  reps: string;
  rir: string;
  /** Что сейчас сохранено на сервере; null — подход ещё не записан. */
  saved: WorkoutSetView | null;
  /** queued — записан на телефоне, уйдёт на сервер, когда появится сеть. */
  state: 'idle' | 'saving' | 'error' | 'queued';
}

const toInput = (n: number) => String(n).replace('.', ',');
const parse = (s: string) => Number(s.trim().replace(',', '.'));

export function WorkoutPage() {
  const { id = '' } = useParams();
  const query = useWorkout(id);
  if (query.isPending) return <Loading text="Загружаю тренировку" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const { workout } = query.data;
  if (workout.finishedAt && workout.analysis) {
    return <Analysis data={query.data} analysis={workout.analysis} />;
  }
  return <Logger key={workout.id} data={query.data} />;
}

/* Запись подходов -------------------------------------------------------- */

function Logger({ data }: { data: WorkoutResponse }) {
  const { workout, session } = data;
  const exercises = useExercises();
  const start = useStartWorkout();
  const saveSet = useSaveSet(workout.id);
  const removeSet = useDeleteSet(workout.id);
  const finish = useFinishWorkout(workout.id);

  const planned = session?.exercises ?? [];
  const [extra, setExtra] = useState<string[]>(() =>
    [...new Set(workout.sets.map((s) => s.exerciseSlug))].filter(
      (slug) => !planned.some((p) => p.slug === slug),
    ),
  );
  const [rows, setRows] = useState<Record<string, Row[]>>(() => initialRows(planned, workout.sets));
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const outbox = useOutbox();
  const waiting = outbox.filter((i) => i.path === `/workouts/${workout.id}/sets`);
  const names = new Map((exercises.data ?? []).map((e) => [e.slug, e]));

  // Очередь ушла на сервер — снимаем жёлтую отметку «ждёт сети».
  useEffect(() => {
    if (waiting.length > 0) return;
    setRows((r) => {
      if (!Object.values(r).some((list) => list.some((x) => x.state === 'queued'))) return r;
      return Object.fromEntries(
        Object.entries(r).map(([k, list]) => [
          k,
          list.map((x) => (x.state === 'queued' ? { ...x, state: 'idle' as const } : x)),
        ]),
      );
    });
  }, [waiting.length]);
  const slugs = [...planned.map((p) => p.slug), ...extra];

  const update = (slug: string, index: number, patch: Partial<Row>) =>
    setRows((r) => ({
      ...r,
      [slug]: (r[slug] ?? []).map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));

  const save = (slug: string, index: number) => {
    const row = rows[slug]![index]!;
    const weightKg = row.weight.trim() === '' ? 0 : parse(row.weight);
    const reps = parse(row.reps);
    const rir = Number(row.rir);
    if (!(weightKg >= 0 && weightKg <= 600) || !Number.isInteger(reps) || reps < 0 || reps > 100) {
      update(slug, index, { state: 'error' });
      return;
    }
    update(slug, index, { state: 'saving' });
    saveSet.mutate(
      { exerciseSlug: slug, setNo: index + 1, weightKg, reps, rir },
      {
        onSuccess: ({ queued, ...saved }) => {
          update(slug, index, { saved, state: queued ? 'queued' : 'idle' });
          setLastSavedAt(Date.now());
          // Следующий подход — с тем же весом.
          setRows((r) => {
            const list = r[slug] ?? [];
            const next = list[index + 1];
            if (!next || next.saved || next.weight) return r;
            return {
              ...r,
              [slug]: list.map((x, i) => (i === index + 1 ? { ...x, weight: row.weight } : x)),
            };
          });
        },
        onError: () => update(slug, index, { state: 'error' }),
      },
    );
  };

  const addRow = (slug: string) =>
    setRows((r) => {
      const list = r[slug] ?? [];
      const last = list[list.length - 1];
      return {
        ...r,
        [slug]: [
          ...list,
          {
            weight: last?.weight ?? '',
            reps: '',
            rir: last?.rir ?? '2',
            saved: null,
            state: 'idle',
          },
        ],
      };
    });

  const removeRow = (slug: string, index: number) => {
    const list = rows[slug] ?? [];
    if (index !== list.length - 1) return;
    const row = list[index]!;
    const drop = () => setRows((r) => ({ ...r, [slug]: (r[slug] ?? []).slice(0, -1) }));
    if (row.saved) removeSet.mutate({ slug, setNo: index + 1 }, { onSuccess: drop });
    else drop();
  };

  const unsaved = slugs.reduce(
    (n, slug) => n + (rows[slug] ?? []).filter((r) => !r.saved && r.reps.trim() !== '').length,
    0,
  );
  const savedCount = slugs.reduce(
    (n, slug) => n + (rows[slug] ?? []).filter((r) => r.saved).length,
    0,
  );

  const onFinish = async () => {
    setError('');
    if (unsaved > 0) {
      setError(`Не записано подходов: ${unsaved}. Нажми «Записать» у каждого или очисти повторы.`);
      return;
    }
    if (waiting.length > 0) {
      await flushOutbox();
      const left = outboxItems().filter((i) => i.path === `/workouts/${workout.id}/sets`).length;
      if (left > 0) {
        setError(
          `Нет сети: ${left} ${plural(left, ['подход ждёт', 'подхода ждут', 'подходов ждут'])} отправки. Разбор будет, когда появится связь.`,
        );
        return;
      }
      setRows((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, list]) => [
            k,
            list.map((x) => (x.state === 'queued' ? { ...x, state: 'idle' as const } : x)),
          ]),
        ),
      );
    }
    finish.mutate(notes, {
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : 'Не получилось завершить. Повтори.'),
    });
  };

  return (
    <main className="page workout">
      <p className="workout-date">
        {shortDay(workout.date)}
        {session && session.date !== workout.date && ` (по плану ${shortDay(session.date)})`}
      </p>
      <h1 className="page-title">{session?.title ?? 'Свободная тренировка'}</h1>

      {!workout.readiness && savedCount === 0 && session && (
        <section className="readiness" aria-labelledby="readiness-heading">
          <h2 id="readiness-heading" className="group-title">
            Как самочувствие?
          </h2>
          <div className="readiness-options">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className="readiness-option"
                onClick={() => start.mutate({ sessionId: session.id, readiness: n })}
                disabled={start.isPending}
              >
                <span className="readiness-score">{n}</span>
                <span>{READINESS_TEXT[n]}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {session && session.adjustments.length > 0 && (
        <ul className="session-adjustments">
          {session.adjustments.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      <RestTimer since={lastSavedAt} />

      {slugs.map((slug) => (
        <ExerciseCard
          key={slug}
          slug={slug}
          plan={planned.find((p) => p.slug === slug)}
          info={names.get(slug)}
          rows={rows[slug] ?? []}
          onChange={(i, patch) => update(slug, i, { ...patch, state: 'idle' })}
          onSave={(i) => save(slug, i)}
          onAdd={() => addRow(slug)}
          onRemove={(i) => removeRow(slug, i)}
        />
      ))}

      <AddExercise
        exercises={exercises.data ?? []}
        taken={slugs}
        onAdd={(slug) => {
          setExtra((x) => [...x, slug]);
          setRows((r) => ({ ...r, [slug]: [emptyRow('2')] }));
        }}
      />

      <div className="field workout-notes">
        <label htmlFor="workout-notes">Заметка к тренировке</label>
        <textarea
          id="workout-notes"
          rows={2}
          maxLength={1000}
          placeholder="Что болело, что мешало, как спал"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button button-wide workout-finish"
        onClick={() => void onFinish()}
        disabled={finish.isPending || savedCount === 0}
      >
        {finish.isPending ? 'Разбираю тренировку…' : 'Завершить и получить разбор'}
      </button>
      <p className="plan-hint">
        Подходы уже сохранены — можно выйти и вернуться. Завершай, когда всё сделал: после этого
        тренер пересчитает веса следующих тренировок.
      </p>
    </main>
  );
}

function emptyRow(rir: string): Row {
  return { weight: '', reps: '', rir, saved: null, state: 'idle' };
}

function initialRows(
  planned: SessionExerciseView[],
  sets: WorkoutSetView[],
): Record<string, Row[]> {
  const result: Record<string, Row[]> = {};
  const slugs = [...new Set([...planned.map((p) => p.slug), ...sets.map((s) => s.exerciseSlug)])];
  for (const slug of slugs) {
    const plan = planned.find((p) => p.slug === slug);
    const logged = sets.filter((s) => s.exerciseSlug === slug).sort((a, b) => a.setNo - b.setNo);
    const count = Math.max(plan?.sets ?? 1, logged.length ? logged[logged.length - 1]!.setNo : 0);
    const planKg = plan?.load.kind === 'kg' ? toInput(plan.load.kg) : '';
    const rir = String(plan?.rir ?? 2);
    result[slug] = Array.from({ length: count }, (_, i) => {
      const s = logged.find((x) => x.setNo === i + 1);
      return s
        ? {
            weight: toInput(s.weightKg),
            reps: String(s.reps),
            rir: String(s.rir),
            saved: s,
            state: 'idle',
          }
        : { weight: planKg, reps: '', rir, saved: null, state: 'idle' };
    });
  }
  return result;
}

interface CardProps {
  slug: string;
  plan: SessionExerciseView | undefined;
  info: ExerciseView | undefined;
  rows: Row[];
  onChange: (index: number, patch: Partial<Row>) => void;
  onSave: (index: number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

function ExerciseCard({ slug, plan, info, rows, onChange, onSave, onAdd, onRemove }: CardProps) {
  const name = plan?.name ?? info?.name ?? slug;
  const perHand = info?.perHand ?? (plan?.load.kind === 'kg' && plan.load.perHand);
  const bodyweight = info?.bodyweight ?? plan?.load.kind === 'bodyweight';
  const target = plan
    ? `${plan.sets} × ${plan.repsMin === plan.repsMax ? plan.repsMin : `${plan.repsMin}–${plan.repsMax}`}, запас ${plan.rir}`
    : 'вне плана';
  const load =
    plan?.load.kind === 'kg'
      ? `${plan.load.basis === 'own' || plan.load.basis === 'target' ? '' : '≈ '}${perHand ? 'по ' : ''}${num(plan.load.kg)} кг`
      : plan?.load.kind === 'bodyweight'
        ? 'свой вес'
        : plan
          ? 'подбери вес'
          : '';
  const done = rows.filter((r) => r.saved).length;

  return (
    <section className="lift-card" aria-labelledby={`ex-${slug}`}>
      <div className="lift-card-head">
        <h2 id={`ex-${slug}`} className="lift-card-title">
          {name}
        </h2>
        <span className="lift-card-load">{load}</span>
        <span className="lift-card-target">
          {target}
          {done > 0 && `, сделано ${done}`}
        </span>
        {plan?.note && <span className="exercise-note">{plan.note}</span>}
      </div>
      <ol className="set-rows">
        {rows.map((row, i) => {
          const dirty =
            row.saved &&
            (toInput(row.saved.weightKg) !== row.weight ||
              String(row.saved.reps) !== row.reps ||
              String(row.saved.rir) !== row.rir);
          const label = `${name}, подход ${i + 1}`;
          return (
            <li
              key={i}
              className="set-row"
              data-saved={(row.saved && !dirty && row.state !== 'queued') || undefined}
              data-queued={(row.state === 'queued' && !dirty) || undefined}
            >
              <span className="set-no" aria-hidden="true">
                {i + 1}
              </span>
              <label className="set-field">
                <span className="set-label">{bodyweight ? '+кг' : perHand ? 'кг/рука' : 'кг'}</span>
                <input
                  inputMode="decimal"
                  aria-label={`${label}: вес${perHand ? ' одной гантели' : ''}`}
                  value={row.weight}
                  placeholder={bodyweight ? '0' : ''}
                  onChange={(e) => onChange(i, { weight: e.target.value })}
                />
              </label>
              <label className="set-field">
                <span className="set-label">повт.</span>
                <input
                  inputMode="numeric"
                  aria-label={`${label}: повторы`}
                  value={row.reps}
                  placeholder={plan ? String(plan.repsMax) : ''}
                  onChange={(e) => onChange(i, { reps: e.target.value })}
                />
              </label>
              <label className="set-field set-rir">
                <span className="set-label">запас</span>
                <select
                  aria-label={`${label}: запас`}
                  value={row.rir}
                  onChange={(e) => onChange(i, { rir: e.target.value })}
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="set-save"
                onClick={() => onSave(i)}
                disabled={
                  row.state === 'saving' ||
                  row.reps.trim() === '' ||
                  (!!row.saved && !dirty && row.state !== 'error')
                }
                aria-label={`${label}: записать`}
              >
                {row.state === 'saving' ? (
                  '…'
                ) : row.saved && !dirty ? (
                  <Check size={24} strokeWidth={3.2} aria-hidden="true" />
                ) : (
                  'Записать'
                )}
              </button>
              {row.state === 'queued' && !dirty && (
                <span className="set-note">
                  Записано на телефоне, отправлю, когда появится сеть.
                </span>
              )}
              {row.state === 'error' && (
                <span className="set-error" role="alert">
                  Не сохранилось: проверь числа и нажми ещё раз.
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="lift-card-actions">
        <button type="button" className="link-button" onClick={onAdd}>
          Добавить подход
        </button>
        {rows.length > 1 && (
          <button type="button" className="link-button" onClick={() => onRemove(rows.length - 1)}>
            Убрать последний
          </button>
        )}
      </div>
    </section>
  );
}

function AddExercise({
  exercises,
  taken,
  onAdd,
}: {
  exercises: ExerciseView[];
  taken: string[];
  onAdd: (slug: string) => void;
}) {
  const options = exercises.filter((e) => !taken.includes(e.slug));
  if (options.length === 0) return null;
  return (
    <label className="field add-exercise">
      <span>Добавить упражнение вне плана</span>
      <select className="select" value="" onChange={(e) => e.target.value && onAdd(e.target.value)}>
        <option value="">Выбери…</option>
        {options.map((e) => (
          <option key={e.slug} value={e.slug}>
            {e.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Сколько прошло с последнего записанного подхода — отдых между подходами. */
function RestTimer({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (since === null) return null;
  const sec = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <p className="rest-timer" aria-live="off">
      <span className="rest-time">
        Отдых {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}
      </span>
      <span className="rest-hint">
        {sec < 120 ? 'базовым нужно 2–4 минуты' : sec < 240 ? 'можно работать' : ''}
      </span>
    </p>
  );
}

/* Разбор ------------------------------------------------------------------ */

const VERDICT_TEXT: Record<ExerciseVerdict, string> = {
  progress: 'Прогресс',
  hold: 'По плану',
  heavy: 'Тяжело',
  under: 'Снижаю',
  first: 'Первая запись',
  skipped: 'Пропущено',
};

function Analysis({ data, analysis }: { data: WorkoutResponse; analysis: WorkoutAnalysis }) {
  const { workout, session } = data;
  return (
    <main className="page workout">
      <p className="workout-date">{shortDay(workout.date)}</p>
      <h1 className="page-title">Разбор: {session?.title ?? 'тренировка'}</h1>
      <p className="page-lead">{analysis.summary}</p>
      {analysis.coachNote && (
        <blockquote className="coach-note">
          <p>{analysis.coachNote}</p>
        </blockquote>
      )}
      {analysis.nextChanges.length > 0 && (
        <section className="plan-step" aria-labelledby="next-heading">
          <h2 id="next-heading" className="group-title">
            Что поменялось в следующих тренировках
          </h2>
          <ul className="next-changes">
            {analysis.nextChanges.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}
      <ul className="test-lifts workout-verdicts">
        {analysis.exercises.map((e) => (
          <li key={e.slug} className="test-lift" data-verdict={e.verdict}>
            <span className="test-verdict">
              {VERDICT_TEXT[e.verdict]}
              {e.record && ', рекорд'}
            </span>
            <span className="test-numbers">
              {e.name}
              {e.plannedSets > 0 && ` — ${e.doneSets} из ${e.plannedSets}`}
            </span>
            <span className="test-text">{e.text}</span>
          </li>
        ))}
      </ul>
      {workout.notes && <p className="plan-hint">Заметка: {workout.notes}</p>}
      <Link to="/plan" className="button button-wide workout-finish">
        К плану
      </Link>
    </main>
  );
}
