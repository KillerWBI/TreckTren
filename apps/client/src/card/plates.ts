/**
 * Блины по стандарту IWF: большие 25/20/15/10/5 кг и малые 2,5/2/1,5/1/0,5 кг тех же цветов.
 * Большие — обязательные разделы карточки, малые — необязательные.
 */
export type PlateColor = 'red' | 'blue' | 'yellow' | 'green' | 'white';

export interface Plate {
  kg: number;
  color: PlateColor;
  /** Диаметр и толщина в единицах SVG втулки. */
  height: number;
  width: number;
}

export const PLATES = {
  r25: { kg: 25, color: 'red', height: 140, width: 30 },
  b20: { kg: 20, color: 'blue', height: 140, width: 26 },
  y15: { kg: 15, color: 'yellow', height: 124, width: 24 },
  g10: { kg: 10, color: 'green', height: 104, width: 22 },
  w5: { kg: 5, color: 'white', height: 80, width: 20 },
  r2_5: { kg: 2.5, color: 'red', height: 66, width: 16 },
  b2: { kg: 2, color: 'blue', height: 62, width: 15 },
  y1_5: { kg: 1.5, color: 'yellow', height: 58, width: 14 },
  g1: { kg: 1, color: 'green', height: 54, width: 13 },
  w0_5: { kg: 0.5, color: 'white', height: 48, width: 12 },
} as const satisfies Record<string, Plate>;

export type PlateId = keyof typeof PLATES;

export const plateFill: Record<PlateColor, string> = {
  red: 'var(--plate-red)',
  blue: 'var(--plate-blue)',
  yellow: 'var(--plate-yellow)',
  green: 'var(--plate-green)',
  white: 'var(--plate-white)',
};
