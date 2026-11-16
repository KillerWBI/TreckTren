import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ruler } from 'lucide-react';
import {
  MEASURE_INFO,
  MEASURE_SITES,
  type MeasureSite,
  type MeasurementEntry,
} from '@trektren/shared';
import { ApiError } from '../api/http';
import { formatDate, num } from '../format';
import { useDeleteMeasurement, useMeasurements, useSaveMeasurement } from './useMeasurements';

const toInput = (n: number) => String(n).replace('.', ',');
const parse = (s: string) => Number(s.trim().replace(',', '.'));
const todayIso = () => new Intl.DateTimeFormat('en-CA').format(new Date());

const RULES = [
  'Мягкая сантиметровая лента (швейная), не рулетка.',
  'Утром натощак, всегда в одно и то же время и в одном положении: стоя, расслабленно.',
  'Лента ровно, параллельно полу, прилегает к коже, но не вдавливается.',
  'Мерь без одежды или в тонком белье, одну и ту же сторону тела.',
  'Каждую меру — два раза: если отличаются больше чем на 0,5 см, измерь в третий раз и возьми среднее.',
];

/** Последнее значение по обхвату и предыдущее — чтобы показать, что изменилось. */
function pair(entries: MeasurementEntry[], site: MeasureSite) {
  const hits = entries.filter((e) => e.girths[site] !== undefined);
  return { now: hits[0], before: hits[1] };
}

export function MeasurementsCard({ autoOpen = false }: { autoOpen?: boolean }) {
  const query = useMeasurements();
  const save = useSaveMeasurement();
  const remove = useDeleteMeasurement();
  const [open, setOpen] = useState(autoOpen);
  const [date, setDate] = useState(todayIso);
  const [values, setValues] = useState<Partial<Record<MeasureSite, string>>>({});
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (autoOpen) ref.current?.scrollIntoView({ block: 'start' });
  }, [autoOpen]);

  if (query.isPending) return null;
  if (query.isError) {
    return (
      <section className="measure-card" id="measurements" aria-label="Замеры тела">
        <p className="form-error">Замеры не загрузились.</p>
        <button type="button" className="link-button" onClick={() => void query.refetch()}>
          Повторить
        </button>
      </section>
    );
  }

  const { entries, due } = query.data;
  const latest = entries[0];

  const onSave = () => {
    setError('');
    const body: Record<string, number | string> = { date };
    for (const site of MEASURE_SITES) {
      const raw = values[site]?.trim();
      if (!raw) continue;
      const v = parse(raw);
      const { min, max, label } = MEASURE_INFO[site];
      if (!Number.isFinite(v) || v < min || v > max) {
        setError(`${label}: от ${min} до ${max} см.`);
        return;
      }
      body[site] = v;
    }
    if (Object.keys(body).length === 1) {
      setError('Впиши хотя бы один замер.');
      return;
    }
    save.mutate(body as never, {
      onSuccess: () => {
        setOpen(false);
        setValues({});
      },
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : 'Не сохранилось. Повтори.'),
    });
  };

  return (
    <section className="measure-card" id="measurements" aria-labelledby="measure-heading" ref={ref}>
      <div className="card-head">
        <h2 id="measure-heading" className="group-title">
          Замеры тела
        </h2>
        {latest && <span className="card-sub">{formatDate(latest.date).replace(' г.', '')}</span>}
      </div>

      <p
        className="notice"
        data-status={due.status}
        role={due.status === 'due' || due.status === 'none' ? 'status' : undefined}
      >
        {due.message}
      </p>

      <details className="measure-rules">
        <summary>Как мерить правильно</summary>
        <ul>
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>

      {!open && (
        <button
          type="button"
          className="button button-small"
          onClick={() => setOpen(true)}
          data-attention={due.status === 'due' || due.status === 'none' || undefined}
        >
          <Ruler size={18} strokeWidth={2.4} aria-hidden="true" />
          {latest ? 'Снять новые замеры' : 'Снять первые замеры'}
        </button>
      )}

      {open && (
        <form
          className="measure-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <label className="field measure-date">
            <span>Дата замера</span>
            <input
              type="date"
              value={date}
              max={todayIso()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <p className="field-hint">
            Можно заполнить не всё: что не мерил — оставь пустым, останется прошлое значение.
          </p>
          {MEASURE_SITES.map((site) => {
            const info = MEASURE_INFO[site];
            const last = pair(entries, site).now;
            return (
              <div key={site} className="measure-field">
                <label className="field">
                  <span>{info.label}, см</span>
                  <input
                    inputMode="decimal"
                    value={values[site] ?? ''}
                    placeholder={last ? toInput(last.girths[site]!) : ''}
                    onChange={(e) => setValues((v) => ({ ...v, [site]: e.target.value }))}
                  />
                </label>
                <details className="measure-hint">
                  <summary>Где мерить</summary>
                  <p>{info.hint}</p>
                </details>
              </div>
            );
          })}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="editor-actions">
            <button type="submit" className="button" disabled={save.isPending}>
              {save.isPending ? 'Сохраняю…' : 'Сохранить и обновить портрет'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setOpen(false);
                setError('');
              }}
            >
              Отмена
            </button>
          </div>
          <p className="field-hint">
            Прошлый портрет сохранится: его можно будет наложить на новый и сравнить.
          </p>
        </form>
      )}

      {latest && (
        <table className="measure-table">
          <caption className="visually-hidden">Последние замеры и изменение</caption>
          <thead>
            <tr>
              <th scope="col">Мера</th>
              <th scope="col">Сейчас</th>
              <th scope="col">Было</th>
              <th scope="col">Разница</th>
            </tr>
          </thead>
          <tbody>
            {MEASURE_SITES.filter((s) => pair(entries, s).now).map((site) => {
              const { now, before } = pair(entries, site);
              const a = now!.girths[site]!;
              const b = before?.girths[site];
              const delta = b === undefined ? null : Math.round((a - b) * 10) / 10;
              return (
                <tr key={site}>
                  <th scope="row">{MEASURE_INFO[site].label}</th>
                  <td>{num(a)}</td>
                  <td>{b === undefined ? '—' : num(b)}</td>
                  <td data-sign={delta === null || delta === 0 ? undefined : delta > 0 ? '+' : '-'}>
                    {delta === null
                      ? '—'
                      : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${num(Math.abs(delta))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {entries.length > 0 && (
        <>
          <button
            type="button"
            className="link-button"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? 'Скрыть историю' : `История замеров (${entries.length})`}
          </button>
          {showHistory && (
            <ul className="measure-history">
              {entries.map((e) => (
                <li key={e.id}>
                  <span className="measure-history-date">
                    {formatDate(e.date).replace(' г.', '')}
                    {e.weightKg !== null && `, ${num(e.weightKg)} кг`}
                  </span>
                  <span className="measure-history-values">
                    {MEASURE_SITES.filter((s) => e.girths[s] !== undefined)
                      .map((s) => `${MEASURE_INFO[s].label.split(' ')[0]} ${num(e.girths[s]!)}`)
                      .join(', ')}
                  </span>
                  <button
                    type="button"
                    className="link-button danger-link"
                    onClick={() => remove.mutate(e.id)}
                    disabled={remove.isPending}
                    aria-label={`Удалить замер от ${formatDate(e.date)}`}
                  >
                    Удалить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

const SNOOZE_KEY = 'trektren.measure-snooze';

function snoozedToday(): boolean {
  try {
    return localStorage.getItem(SNOOZE_KEY) === todayIso();
  } catch {
    return false;
  }
}

/** Напоминание на главной: появляется, когда пора мерить, и прячется на день по «Позже». */
export function MeasureReminder() {
  const query = useMeasurements();
  const [hidden, setHidden] = useState(snoozedToday);
  const due = query.data?.due;
  if (!due || hidden || (due.status !== 'due' && due.status !== 'none')) return null;
  return (
    <aside className="notice notice-warn measure-reminder" aria-label="Напоминание о замерах">
      <p>{due.message}</p>
      <div className="editor-actions">
        <Link to="/card#measurements" className="button button-small">
          Снять замеры
        </Link>
        <button
          type="button"
          className="button button-small button-secondary"
          onClick={() => {
            try {
              localStorage.setItem(SNOOZE_KEY, todayIso());
            } catch {
              /* без хранилища напоминание просто вернётся при следующем открытии */
            }
            setHidden(true);
          }}
        >
          Позже
        </button>
      </div>
    </aside>
  );
}
