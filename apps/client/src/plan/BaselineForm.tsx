import { useState } from 'react';
import type { AthleteCard } from '@trektren/shared';
import { ApiError } from '../api/http';
import { num } from '../format';
import { useExercises, useSaveBaseline } from './usePlan';

interface Row {
  weight: string;
  reps: string;
}

/**
 * Стартовые веса для базовых движений: вес × повторы, которые человек точно делает.
 * Из них считается 1ПМ, а от него — рабочие веса в плане. Пустые строки не отправляются.
 */
export function BaselineForm({
  card,
  onDone,
}: {
  card: AthleteCard;
  onDone: (saved: boolean) => void;
}) {
  const exercises = useExercises();
  const save = useSaveBaseline();
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [error, setError] = useState('');
  const lifts = card.strength?.lifts ?? {};

  if (exercises.isPending) return <p className="state">Загружаю упражнения…</p>;
  if (exercises.isError) return <p className="form-error">Не получилось загрузить упражнения.</p>;

  const baseline = exercises.data.filter((e) => e.baseline);
  const set = (slug: string, key: keyof Row, value: string) =>
    setRows((r) => ({ ...r, [slug]: { weight: '', reps: '5', ...r[slug], [key]: value } }));

  const submit = () => {
    setError('');
    const payload = [];
    for (const e of baseline) {
      const row = rows[e.slug];
      if (!row || row.weight.trim() === '') continue;
      const weightKg = Number(row.weight.replace(',', '.'));
      const reps = Number(row.reps);
      if (!(weightKg >= 1 && weightKg <= 500) || !Number.isInteger(reps) || reps < 1 || reps > 12) {
        setError(`${e.name}: вес от 1 до 500 кг, повторов от 1 до 12.`);
        return;
      }
      payload.push({ slug: e.slug, weightKg, reps });
    }
    if (payload.length === 0) {
      setError('Впиши вес хотя бы в одном упражнении — или закрой, если пока не знаешь.');
      return;
    }
    save.mutate(payload, {
      onSuccess: () => onDone(true),
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : 'Не получилось сохранить.'),
    });
  };

  return (
    <form
      className="editor baseline"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <p className="editor-note">
        Вес, который ты точно сделаешь на указанное число повторов, в хорошей технике. Тренер
        посчитает максимум и рабочие веса. Чего не знаешь — оставь пустым: эти веса подберёшь на
        первой тренировке по запасу повторов.
      </p>
      {baseline.map((e) => {
        const row = rows[e.slug];
        const current = lifts[e.slug];
        return (
          <fieldset key={e.slug} className="baseline-row">
            <legend>{e.name}</legend>
            <label className="baseline-input">
              <span className="visually-hidden">Вес, кг</span>
              <input
                inputMode="decimal"
                placeholder="кг"
                value={row?.weight ?? ''}
                onChange={(ev) => set(e.slug, 'weight', ev.target.value)}
              />
            </label>
            <span aria-hidden="true">×</span>
            <label className="baseline-input baseline-reps">
              <span className="visually-hidden">Повторов</span>
              <input
                inputMode="numeric"
                value={row?.reps ?? '5'}
                onChange={(ev) => set(e.slug, 'reps', ev.target.value)}
              />
            </label>
            {current && (
              <span className="baseline-current">
                сейчас 1ПМ {num(current.oneRmKg)} кг{current.estimated ? ' (расчёт)' : ''}
              </span>
            )}
          </fieldset>
        );
      })}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="editor-actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending ? 'Сохраняю…' : 'Сохранить веса'}
        </button>
        <button type="button" className="button button-secondary" onClick={() => onDone(false)}>
          Закрыть
        </button>
      </div>
    </form>
  );
}
