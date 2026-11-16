import {
  MEASURE_SITES,
  type Girths,
  type MeasurementDue,
  type MeasurementInput,
  type MeasurementsResponse,
} from '@trektren/shared';
import { diffDays } from '../../dates.js';
import { pool } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { getPortrait } from '../progress/portrait.js';
import { userToday } from '../strength/service.js';
import { loadMeasurements, type MeasurementRow } from './repo.js';

/** Раньше этого срока перемерять смысла нет: за меньшее время тело меняется меньше погрешности ленты. */
export const REMEASURE_DAYS = 28;
const SOON_DAYS = 21;
/** Вес ушёл на столько — тело уже другое, даже если месяц не прошёл. */
const WEIGHT_SHIFT_KG = 2;
const MIN_DAYS_FOR_WEIGHT_SHIFT = 10;

async function latestWeight(userId: string): Promise<number | null> {
  const { rows } = await pool.query<{ weight_kg: string }>(
    `SELECT weight_kg FROM weight_logs WHERE user_id = $1
     ORDER BY date DESC, time_of_day = 'morning' DESC LIMIT 1`,
    [userId],
  );
  return rows[0] ? Number(rows[0].weight_kg) : null;
}

const word = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
};

export function dueFor(
  last: Pick<MeasurementRow, 'date' | 'weightKg'> | undefined,
  today: string,
  weightNow: number | null,
): MeasurementDue {
  if (!last) {
    return {
      status: 'none',
      daysSince: null,
      message:
        'Замеров ещё нет. Сними обхваты лентой — манекен на портрете станет похож на тебя, а через месяц будет видно, что изменилось.',
    };
  }
  const days = Math.max(0, diffDays(last.date, today));
  const shift =
    last.weightKg !== null && weightNow !== null
      ? Math.round((weightNow - last.weightKg) * 10) / 10
      : 0;
  if (days >= REMEASURE_DAYS) {
    return {
      status: 'due',
      daysSince: days,
      message: `С прошлых замеров прошло ${days} ${word(days)} — пора перемерить: за это время тело уже заметно изменилось.`,
    };
  }
  if (days >= MIN_DAYS_FOR_WEIGHT_SHIFT && Math.abs(shift) >= WEIGHT_SHIFT_KG) {
    return {
      status: 'due',
      daysSince: days,
      message: `Вес изменился на ${shift > 0 ? '+' : '−'}${String(Math.abs(shift)).replace('.', ',')} кг с прошлых замеров — есть смысл перемерить, чтобы манекен не отставал.`,
    };
  }
  if (days >= SOON_DAYS) {
    return {
      status: 'soon',
      daysSince: days,
      message: `Прошло ${days} ${word(days)}. Перемерить можно через ${REMEASURE_DAYS - days} ${word(REMEASURE_DAYS - days)}: раньше разница будет меньше погрешности ленты.`,
    };
  }
  return {
    status: 'ok',
    daysSince: days,
    message: `Замеры свежие (${days} ${word(days)} назад). Следующие — через ${REMEASURE_DAYS - days} ${word(REMEASURE_DAYS - days)}: раньше тело не успеет измениться заметнее ошибки ленты.`,
  };
}

export async function getMeasurements(userId: string): Promise<MeasurementsResponse> {
  const [rows, today, weightNow] = await Promise.all([
    loadMeasurements(userId),
    userToday(userId),
    latestWeight(userId),
  ]);
  return {
    entries: rows.map((r) => ({
      id: r.id,
      date: r.date,
      girths: r.girths,
      weightKg: r.weightKg,
    })),
    due: dueFor(rows[0], today, weightNow),
  };
}

export async function saveMeasurement(
  userId: string,
  input: MeasurementInput,
): Promise<MeasurementsResponse> {
  const today = await userToday(userId);
  const date = input.date ?? today;
  if (date > today) throw new AppError(400, 'VALIDATION_ERROR', 'Дата замера не в будущем');

  const girths: Girths = {};
  for (const site of MEASURE_SITES) {
    const v = input[site];
    if (v !== undefined) girths[site] = Math.round(v * 10) / 10;
  }
  const weight = await latestWeight(userId);
  // Повторный замер за тот же день дополняет прежний: не всё мерят за один раз.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO measurement_logs (user_id, date, girths, weight_kg) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, date)
     DO UPDATE SET girths = measurement_logs.girths || EXCLUDED.girths, weight_kg = EXCLUDED.weight_kg
     RETURNING id`,
    [userId, date, JSON.stringify(girths), weight],
  );
  // Снимок портрета на этот день: портрет уже видит новый замер, старые снимки остаются для сравнения.
  const portrait = await getPortrait(userId);
  await pool.query('UPDATE measurement_logs SET body = $2 WHERE id = $1', [
    rows[0]!.id,
    JSON.stringify(portrait.body),
  ]);
  return getMeasurements(userId);
}

export async function deleteMeasurement(userId: string, id: string): Promise<MeasurementsResponse> {
  const { rowCount } = await pool.query(
    'DELETE FROM measurement_logs WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  if (!rowCount) throw notFound('Замер не найден');
  return getMeasurements(userId);
}
