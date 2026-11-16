import { MEASURE_SITES, type Girths, type PortraitBody } from '@trektren/shared';
import { pool } from '../../db.js';

interface Row {
  id: string;
  date: string;
  girths: Girths;
  weight_kg: string | null;
  body: PortraitBody | null;
}

export interface MeasurementRow {
  id: string;
  date: string;
  girths: Girths;
  weightKg: number | null;
  body: PortraitBody | null;
}

/** Все замеры человека, новые сверху. */
export async function loadMeasurements(userId: string): Promise<MeasurementRow[]> {
  const { rows } = await pool.query<Row>(
    `SELECT id, to_char(date, 'YYYY-MM-DD') AS date, girths, weight_kg, body
     FROM measurement_logs WHERE user_id = $1 ORDER BY date DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    girths: r.girths,
    weightKg: r.weight_kg === null ? null : Number(r.weight_kg),
    body: r.body,
  }));
}

/** Свежайшее значение по каждому обхвату: не все меры снимают каждый раз. */
export function latestGirths(rows: MeasurementRow[]): { girths: Girths; date: string | null } {
  const girths: Girths = {};
  for (const site of MEASURE_SITES) {
    const hit = rows.find((r) => r.girths[site] !== undefined);
    if (hit) girths[site] = hit.girths[site]!;
  }
  return { girths, date: rows[0]?.date ?? null };
}
