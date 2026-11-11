const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** '2027-03-01' → '1 марта 2027 г.' без сдвига часового пояса. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return dateFmt.format(new Date(y!, (m ?? 1) - 1, d ?? 1));
}

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

export function ageFrom(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = today.getFullYear() - y!;
  const beforeBirthday =
    today.getMonth() + 1 < m! || (today.getMonth() + 1 === m && today.getDate() < d!);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Склонение: plural(3, ['тренировка', 'тренировки', 'тренировок']). */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export const num = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
