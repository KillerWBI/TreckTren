/** Даты 'YYYY-MM-DD' без часовых поясов: вся арифметика в UTC. */

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso: string, days: number) => fromMs(toMs(iso) + days * DAY);
export const diffDays = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);

/** ISO-день недели: 1 = понедельник … 7 = воскресенье. */
export function isoWeekday(iso: string): number {
  const d = new Date(toMs(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

export function addMonths(firstOfMonth: string, n: number): string {
  const [y, m] = firstOfMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return fromMs(d.getTime());
}

/** Клетки месяца с понедельника: null — пустые клетки до первого числа. */
export function monthCells(firstOfMonth: string): Array<string | null> {
  const lead = isoWeekday(firstOfMonth) - 1;
  const next = addMonths(firstOfMonth, 1);
  const days = diffDays(firstOfMonth, next);
  return [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => addDays(firstOfMonth, i)),
  ];
}

const monthFmt = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayFmt = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const fullFmt = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

export function monthTitle(firstOfMonth: string): string {
  const s = monthFmt.format(new Date(toMs(firstOfMonth))).replace(' г.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 'пн, 16 ноября' */
export const shortDay = (iso: string) => dayFmt.format(new Date(toMs(iso)));
/** 'понедельник, 16 ноября' — для экранных читалок. */
export const fullDay = (iso: string) => fullFmt.format(new Date(toMs(iso)));
