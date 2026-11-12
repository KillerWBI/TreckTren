import { useState } from 'react';
import { addMonths, diffDays, fullDay, monthCells, monthStart, monthTitle } from './dates';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

interface Props {
  selected: Set<string>;
  onToggle: (date: string) => void;
  today: string;
  /** Последний день, который можно отметить. */
  last: string;
}

/**
 * Месяц с понедельника. Отмеченный день — тренировка; между двумя тренировками
 * подряд клетка помечается «без отдыха», чтобы сразу было видно, где мало восстановления.
 */
export function Calendar({ selected, onToggle, today, last }: Props) {
  const [month, setMonth] = useState(() => monthStart(today));
  const canBack = month > monthStart(today);
  const canForward = addMonths(month, 1) <= last;

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button
          type="button"
          className="calendar-nav"
          onClick={() => setMonth(addMonths(month, -1))}
          disabled={!canBack}
          aria-label="Предыдущий месяц"
        >
          ‹
        </button>
        <p className="calendar-title" aria-live="polite">
          {monthTitle(month)}
        </p>
        <button
          type="button"
          className="calendar-nav"
          onClick={() => setMonth(addMonths(month, 1))}
          disabled={!canForward}
          aria-label="Следующий месяц"
        >
          ›
        </button>
      </div>
      <div
        className="calendar-grid"
        role="group"
        aria-label={`Дни тренировок, ${monthTitle(month)}`}
      >
        {WEEKDAYS.map((d) => (
          <span key={d} className="calendar-weekday" aria-hidden="true">
            {d}
          </span>
        ))}
        {monthCells(month).map((date, i) => {
          if (!date) return <span key={`pad-${i}`} />;
          const disabled = date < today || date > last;
          const on = selected.has(date);
          const tight = on && selected.has(prevDay(date));
          return (
            <button
              key={date}
              type="button"
              className="calendar-day"
              aria-pressed={on}
              data-today={date === today || undefined}
              data-tight={tight || undefined}
              disabled={disabled}
              aria-label={`${fullDay(date)}${tight ? ', второй день подряд' : ''}`}
              onClick={() => onToggle(date)}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function prevDay(date: string): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000);
  return d.toISOString().slice(0, 10);
}

export interface ScheduleSummary {
  count: number;
  weeks: number;
  perWeek: number;
  backToBack: number;
  longestGap: number;
}

export function summarize(dates: string[]): ScheduleSummary {
  const sorted = [...dates].sort();
  const gaps = sorted.slice(1).map((d, i) => diffDays(sorted[i]!, d));
  const span = sorted.length > 1 ? diffDays(sorted[0]!, sorted[sorted.length - 1]!) + 1 : 7;
  const weeks = Math.max(1, Math.ceil(span / 7));
  return {
    count: sorted.length,
    weeks,
    perWeek: Math.round((sorted.length / weeks) * 10) / 10,
    backToBack: gaps.filter((g) => g === 1).length,
    longestGap: gaps.length > 0 ? Math.max(...gaps) : 0,
  };
}
