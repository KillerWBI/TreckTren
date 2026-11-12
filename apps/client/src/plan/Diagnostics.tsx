import { useState } from 'react';
import type { DiagnosticCheck, DiagnosticTest } from '@trektren/shared';
import { ApiError } from '../api/http';
import { formatDate } from '../format';
import { useDiagnostics, useSubmitDiagnostic } from './usePlan';

const UNIT: Record<DiagnosticTest['unit'], string> = {
  kg: 'кг',
  reps: 'повт.',
  cm: 'см',
  sec: 'сек',
};

/** «Где проседает»: тренер сам сравнивает максимумы, даёт тесты и делает вывод. */
export function Diagnostics() {
  const query = useDiagnostics();
  if (query.isPending || query.isError) return null;
  const { checks, note } = query.data;

  return (
    <section className="diagnostics" aria-labelledby="diagnostics-heading">
      <h2 id="diagnostics-heading" className="group-title">
        Где проседает
      </h2>
      {checks.length === 0 && note && <p className="plan-hint">{note}</p>}
      {checks.map((check) => (
        <Check key={check.finding.id} check={check} />
      ))}
    </section>
  );
}

function Check({ check }: { check: DiagnosticCheck }) {
  const submit = useSubmitDiagnostic();
  const [editing, setEditing] = useState(!check.last);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const send = () => {
    setError('');
    const results: Record<string, number> = {};
    for (const t of check.tests) {
      const raw = (values[t.id] ?? '').trim().replace(',', '.');
      if (raw === '') continue;
      const n = Number(raw);
      if (!(n >= 0 && n <= 600)) return setError(`${t.title}: число от 0 до 600.`);
      results[t.id] = n;
    }
    if (Object.keys(results).length === 0) return setError('Впиши результат хотя бы одного теста.');
    submit.mutate(
      { findingId: check.finding.id, results },
      {
        onSuccess: () => setEditing(false),
        onError: (err) =>
          setError(err instanceof ApiError ? err.message : 'Не получилось сохранить.'),
      },
    );
  };

  return (
    <div className="check-card">
      <p className="check-finding">{check.finding.text}</p>
      {check.last && !editing ? (
        <>
          <p className="check-summary">{check.last.summary}</p>
          <p className="plan-hint">
            Проверено {formatDate(check.last.date).replace(' г.', '')}. Вывод записан в «Слабые
            места» карточки — перестрой план, чтобы тренер добавил это в тренировки.
          </p>
          <button type="button" className="link-button" onClick={() => setEditing(true)}>
            Проверить заново
          </button>
        </>
      ) : (
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          noValidate
        >
          <p className="editor-note">
            Сделай эти тесты на ближайшей тренировке после разминки и впиши результаты. Можно не все
            — тренер сделает вывод по тому, что есть.
          </p>
          {check.tests.map((t) => (
            <div key={t.id} className="field check-test">
              <label htmlFor={`t-${check.finding.id}-${t.id}`}>{t.title}</label>
              <span className="field-hint">{t.howTo}</span>
              <span className="input-unit">
                <input
                  id={`t-${check.finding.id}-${t.id}`}
                  inputMode="decimal"
                  value={values[t.id] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [t.id]: e.target.value }))}
                />
                <span className="unit">{UNIT[t.unit]}</span>
              </span>
            </div>
          ))}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="editor-actions">
            <button type="submit" className="button" disabled={submit.isPending}>
              {submit.isPending ? 'Разбираю…' : 'Получить вывод'}
            </button>
            {check.last && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setEditing(false)}
              >
                Отмена
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
