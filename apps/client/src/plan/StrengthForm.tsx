import { useState } from 'react';
import {
  resolveOneRm,
  type AthleteCard,
  type ExerciseView,
  type LiftRecord,
  type StrengthUpdate,
} from '@trektren/shared';
import { ApiError } from '../api/http';
import { num } from '../format';
import { useExercises, useSaveStrength } from './usePlan';

interface Row {
  max: string;
  weight: string;
  reps: string;
  rir: string;
  target: string;
}

const toInput = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));
const parse = (s: string) => {
  const t = s.trim().replace(',', '.');
  return t === '' ? null : Number(t);
};

function rowFrom(lift: LiftRecord | undefined, target: number | undefined): Row {
  return {
    max: toInput(lift?.testedKg),
    weight: toInput(lift?.working?.weightKg),
    reps: toInput(lift?.working?.reps),
    rir: lift?.working ? String(lift.working.rir) : '1',
    target: toInput(target),
  };
}

/** Сначала троеборье, потом остальные базовые. */
const FIRST = ['barbell-back-squat', 'bench-press', 'deadlift', 'overhead-press', 'barbell-row'];
const order = (slug: string) => {
  const i = FIRST.indexOf(slug);
  return i === -1 ? FIRST.length : i;
};

/** Упражнения, для которых имеет смысл вес в килограммах: свободные веса, не блоки и не свой вес. */
const weighted = (e: ExerciseView) => !e.bodyweight && !e.stack;

/**
 * «Силовые»: по каждому упражнению максимум на 1 раз, рабочий подход и цель.
 * Максимум, который реально сделан, — правда. Рабочий подход нужен, если максимума нет
 * или чтобы тренер видел, как идут обычные тренировки.
 */
export function StrengthForm({
  card,
  onDone,
}: {
  card: AthleteCard;
  onDone: (saved: boolean) => void;
}) {
  const exercises = useExercises();
  const save = useSaveStrength();
  const lifts = card.strength?.lifts ?? {};
  const targets = card.strength?.targets ?? {};
  const [extra, setExtra] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [error, setError] = useState('');

  if (exercises.isPending) return <p className="state">Загружаю упражнения…</p>;
  if (exercises.isError) return <p className="form-error">Не получилось загрузить упражнения.</p>;

  const base = exercises.data
    .filter((e) => e.baseline)
    .map((e) => e.slug)
    .sort((a, b) => order(a) - order(b));
  const slugs = [...new Set([...base, ...Object.keys(lifts), ...Object.keys(targets), ...extra])];
  const bySlug = new Map(exercises.data.map((e) => [e.slug, e]));
  const rowOf = (slug: string) => rows[slug] ?? rowFrom(lifts[slug], targets[slug]);
  const set = (slug: string, key: keyof Row, value: string) =>
    setRows((r) => ({
      ...r,
      [slug]: { ...(r[slug] ?? rowFrom(lifts[slug], targets[slug])), [key]: value },
    }));
  const addable = exercises.data.filter((e) => weighted(e) && !slugs.includes(e.slug));

  const submit = () => {
    setError('');
    const update: StrengthUpdate = { lifts: [], targets: {} };
    for (const slug of slugs) {
      const row = rows[slug];
      if (!row) continue;
      const name = bySlug.get(slug)?.name ?? slug;
      const current = lifts[slug];
      const max = parse(row.max);
      const weight = parse(row.weight);
      const reps = parse(row.reps);
      const rir = Number(row.rir);
      const target = parse(row.target);

      if (max !== null && !(max >= 1 && max <= 600))
        return setError(`${name}: максимум от 1 до 600 кг.`);
      if (target !== null && !(target >= 1 && target <= 600))
        return setError(`${name}: цель от 1 до 600 кг.`);
      if ((weight === null) !== (reps === null)) {
        return setError(`${name}: для рабочего подхода нужны и вес, и повторы.`);
      }
      if (weight !== null && reps !== null) {
        if (!(weight >= 1 && weight <= 600))
          return setError(`${name}: рабочий вес от 1 до 600 кг.`);
        if (!Number.isInteger(reps) || reps < 1 || reps > 20) {
          return setError(`${name}: повторов от 1 до 20.`);
        }
      }

      const change: StrengthUpdate['lifts'][number] = { slug };
      if (max !== (current?.testedKg ?? null)) change.testedKg = max;
      const working = weight !== null && reps !== null ? { weightKg: weight, reps, rir } : null;
      const cw = current?.working;
      const same =
        working && cw
          ? working.weightKg === cw.weightKg && working.reps === cw.reps && working.rir === cw.rir
          : working === (cw ?? null);
      if (!same) change.working = working;
      if ('testedKg' in change || 'working' in change) update.lifts.push(change);
      if (target !== (targets[slug] ?? null)) update.targets![slug] = target;
    }
    if (update.lifts.length === 0 && Object.keys(update.targets!).length === 0) {
      onDone(false);
      return;
    }
    save.mutate(update, {
      onSuccess: () => onDone(true),
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : 'Не получилось сохранить.'),
    });
  };

  return (
    <form
      className="editor strength"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <p className="editor-note">
        <strong>Максимум</strong> — вес, который ты реально поднял на 1 раз.{' '}
        <strong>Рабочий</strong> — обычный тяжёлый подход: вес × повторы и сколько ещё мог сделать.
        Если есть максимум, веса в плане считаются от него, иначе — от рабочего подхода. Остальные
        упражнения тренер посчитает от этих.
      </p>
      {slugs.map((slug) => {
        const e = bySlug.get(slug);
        const row = rowOf(slug);
        const resolved = resolveOneRm({
          testedKg: parse(row.max) ?? undefined,
          working:
            parse(row.weight) && parse(row.reps)
              ? { weightKg: parse(row.weight)!, reps: parse(row.reps)!, rir: Number(row.rir) }
              : undefined,
        });
        const id = `lift-${slug}`;
        return (
          <fieldset key={slug} className="lift" aria-describedby={`${id}-basis`}>
            <legend>
              {e?.name ?? slug}
              {e?.perHand && <span className="legend-note"> — вес одной гантели</span>}
            </legend>
            <label className="lift-field">
              <span>Максимум</span>
              <span className="lift-input">
                <input
                  inputMode="decimal"
                  value={row.max}
                  onChange={(ev) => set(slug, 'max', ev.target.value)}
                />
                <span className="unit">кг</span>
              </span>
            </label>
            <label className="lift-field">
              <span>Цель</span>
              <span className="lift-input">
                <input
                  inputMode="decimal"
                  value={row.target}
                  onChange={(ev) => set(slug, 'target', ev.target.value)}
                />
                <span className="unit">кг</span>
              </span>
            </label>
            <div
              className="lift-working"
              role="group"
              aria-label={`${e?.name ?? slug}: рабочий подход`}
            >
              <span className="lift-label">Рабочий</span>
              <label className="lift-input">
                <span className="visually-hidden">Вес</span>
                <input
                  inputMode="decimal"
                  value={row.weight}
                  onChange={(ev) => set(slug, 'weight', ev.target.value)}
                />
                <span className="unit">кг</span>
              </label>
              <span aria-hidden="true">×</span>
              <label className="lift-input lift-reps">
                <span className="visually-hidden">Повторов</span>
                <input
                  inputMode="numeric"
                  value={row.reps}
                  onChange={(ev) => set(slug, 'reps', ev.target.value)}
                />
              </label>
              <label className="lift-rir">
                <span>запас</span>
                <select value={row.rir} onChange={(ev) => set(slug, 'rir', ev.target.value)}>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p id={`${id}-basis`} className="lift-basis">
              {resolved
                ? `Считаю от ${num(resolved.oneRmKg)} кг — ${resolved.estimated ? 'расчёт по рабочему подходу' : 'твой максимум'}`
                : 'Нет данных — посчитаю от других упражнений'}
            </p>
          </fieldset>
        );
      })}

      {addable.length > 0 && (
        <label className="field">
          <span>Добавить упражнение</span>
          <select
            className="select"
            value=""
            onChange={(ev) => ev.target.value && setExtra((x) => [...x, ev.target.value])}
          >
            <option value="">Выбери…</option>
            {addable.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="editor-actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending ? 'Сохраняю…' : 'Сохранить'}
        </button>
        <button type="button" className="button button-secondary" onClick={() => onDone(false)}>
          Закрыть
        </button>
      </div>
    </form>
  );
}

/** Коротко для карточки: «Присед со штангой 120, Жим лёжа 100 (цель 120)». */
export function strengthSummary(card: AthleteCard, names: Map<string, string>): string {
  const lifts = card.strength?.lifts ?? {};
  const targets = card.strength?.targets ?? {};
  return Object.entries(lifts)
    .map(([slug, l]) => {
      const goal = targets[slug] ? ` → ${num(targets[slug])}` : '';
      return `${names.get(slug) ?? slug} ${l.estimated ? '≈' : ''}${num(l.oneRmKg)}${goal}`;
    })
    .join(', ');
}
