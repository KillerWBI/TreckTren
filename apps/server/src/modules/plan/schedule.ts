import { diffDays } from '../../dates.js';

export interface ScheduleInfo {
  dates: string[];
  /** Промежутки между соседними тренировками в днях. */
  gaps: number[];
  /** Среднее число тренировок в неделю по выбранным датам. */
  perWeek: number;
}

/** Сводка выбранных дней: из неё выбирается сплит. */
export function describeSchedule(dates: string[], fallbackPerWeek?: number): ScheduleInfo {
  const gaps = dates.slice(1).map((d, i) => diffDays(dates[i]!, d));
  const spanDays = dates.length > 1 ? diffDays(dates[0]!, dates[dates.length - 1]!) + 1 : 7;
  const weeks = Math.max(1, Math.ceil(spanDays / 7));
  let perWeek = Math.round(dates.length / weeks);
  // По 1–2 датам частоту не понять — берём из карточки.
  if (dates.length < 3 && fallbackPerWeek) perWeek = fallbackPerWeek;
  return { dates, gaps, perWeek: Math.min(6, Math.max(1, perWeek)) };
}
