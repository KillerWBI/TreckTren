/** Даты как строки 'YYYY-MM-DD'; арифметика в UTC, чтобы не ловить сдвиги часовых поясов. */

const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 24 * 60 * 60 * 1000;

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY);
}

/** b − a в днях. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY);
}

/** Понедельник недели, в которую попадает дата. */
export function mondayOf(iso: string): string {
  const weekday = new Date(toUtc(iso)).getUTCDay(); // 0 = воскресенье
  return addDays(iso, -((weekday + 6) % 7));
}

/** Сегодня в часовом поясе пользователя. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function uniqueSorted(dates: string[]): string[] {
  return [...new Set(dates)].sort();
}
