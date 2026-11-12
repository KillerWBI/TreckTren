import { useState } from 'react';
import type { SessionView, TestResult, TestVerdict } from '@trektren/shared';
import { ApiError } from '../api/http';
import { num } from '../format';
import { useRecordTest } from './usePlan';

const VERDICT_TEXT: Record<TestVerdict, string> = {
  above: 'Прогноз выполнен',
  near: 'Почти',
  below: 'Ниже прогноза',
  regress: 'Регресс',
};

/** Ввод результата проходки: лучший вес и сколько раз. */
export function TestForm({ session, today }: { session: SessionView; today: string }) {
  const record = useRecordTest();
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      session.exercises.map((x) => [
        x.slug,
        {
          weight: x.load.kind === 'kg' ? String(x.load.kg).replace('.', ',') : '',
          reps: '1',
          skip: false,
        },
      ]),
    ),
  );
  const [error, setError] = useState('');

  if (session.result) return <TestResultView result={session.result} />;
  if (session.date > today) {
    return <p className="plan-hint">Результат запишешь в день проходки — сюда же.</p>;
  }

  const submit = () => {
    setError('');
    const lifts = [];
    for (const x of session.exercises) {
      const row = rows[x.slug]!;
      if (row.skip) continue;
      const weightKg = Number(row.weight.replace(',', '.'));
      const reps = Number(row.reps);
      if (!(weightKg >= 1 && weightKg <= 600) || !Number.isInteger(reps) || reps < 1 || reps > 15) {
        return setError(`${x.name}: вес от 1 до 600 кг, повторов от 1 до 15.`);
      }
      lifts.push({ slug: x.slug, weightKg, reps });
    }
    if (lifts.length === 0) return setError('Впиши результат хотя бы одного движения.');
    record.mutate(
      { sessionId: session.id, lifts },
      {
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : 'Не получилось сохранить.'),
      },
    );
  };

  return (
    <form
      className="editor test-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <p className="editor-note">
        Лучший вес, который сделал, и сколько раз. Не дотянул до прогноза — всё равно впиши: тренер
        сверит и скажет, что менять.
      </p>
      {session.exercises.map((x) => {
        const row = rows[x.slug]!;
        const set = (patch: Partial<typeof row>) =>
          setRows((r) => ({ ...r, [x.slug]: { ...row, ...patch } }));
        return (
          <fieldset key={x.slug} className="test-row" disabled={row.skip}>
            <legend>{x.name}</legend>
            <label className="lift-input">
              <span className="visually-hidden">Вес</span>
              <input
                inputMode="decimal"
                value={row.weight}
                onChange={(e) => set({ weight: e.target.value })}
              />
              <span className="unit">кг</span>
            </label>
            <span aria-hidden="true">×</span>
            <label className="lift-input lift-reps">
              <span className="visually-hidden">Повторов</span>
              <input
                inputMode="numeric"
                value={row.reps}
                onChange={(e) => set({ reps: e.target.value })}
              />
            </label>
            <label className="check test-skip">
              <input
                type="checkbox"
                checked={row.skip}
                onChange={(e) => set({ skip: e.target.checked })}
              />
              <span>не делал</span>
            </label>
          </fieldset>
        );
      })}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={record.isPending}>
        {record.isPending ? 'Сверяю…' : 'Записать проходку'}
      </button>
    </form>
  );
}

function TestResultView({ result }: { result: TestResult }) {
  return (
    <div className="test-result">
      <ul className="test-lifts">
        {result.lifts.map((l) => (
          <li key={l.slug} className="test-lift" data-verdict={l.verdict}>
            <span className="test-verdict">{VERDICT_TEXT[l.verdict]}</span>
            <span className="test-numbers">
              {l.name}: {num(l.oneRmKg)} из {num(l.targetKg)}
            </span>
            <span className="test-text">{l.text}</span>
          </li>
        ))}
      </ul>
      <p className="coach-note test-summary">{result.summary}</p>
    </div>
  );
}
