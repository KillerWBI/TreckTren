import { z } from 'zod';

/** Обхваты тела, которыми манекен на портрете подгоняется под человека. */
export const MEASURE_SITES = [
  'neck',
  'shoulders',
  'chest',
  'waist',
  'hips',
  'arm',
  'forearm',
  'thigh',
  'calf',
] as const;
export type MeasureSite = (typeof MEASURE_SITES)[number];

export type Girths = Partial<Record<MeasureSite, number>>;

export interface MeasureInfo {
  label: string;
  /** Где и как мерить: одна точка, одно положение — иначе цифры не сравнить. */
  hint: string;
  /** Допустимый обхват, см. */
  min: number;
  max: number;
}

export const MEASURE_INFO: Record<MeasureSite, MeasureInfo> = {
  neck: {
    label: 'Шея',
    hint: 'Под кадыком, лента горизонтально. Голову держи прямо, плечи опусти, не тяни шею вперёд.',
    min: 25,
    max: 60,
  },
  shoulders: {
    label: 'Плечи',
    hint: 'Вокруг самых широких точек дельт и верха груди, руки опущены вдоль тела. Лента идёт ровно, по спине не провисает. Проще с помощником.',
    min: 80,
    max: 170,
  },
  chest: {
    label: 'Грудь',
    hint: 'На уровне сосков, лента ровно вокруг, под мышками. Руки опущены, дыши спокойно, мерь на выдохе. Не стягивай.',
    min: 60,
    max: 170,
  },
  waist: {
    label: 'Талия',
    hint: 'На уровне пупка (у женщин — в самом узком месте). Утром натощак, на выдохе, живот не втягивай и не выпячивай.',
    min: 50,
    max: 170,
  },
  hips: {
    label: 'Бёдра и ягодицы',
    hint: 'Вокруг самой широкой части ягодиц, лента ровно. Стоишь прямо, ноги вместе, вес на обе ноги.',
    min: 60,
    max: 180,
  },
  arm: {
    label: 'Рука (бицепс)',
    hint: 'Посередине между плечом и локтем, рука опущена и расслаблена, не напрягай. Мерь всегда одну и ту же руку.',
    min: 15,
    max: 60,
  },
  forearm: {
    label: 'Предплечье',
    hint: 'В самом толстом месте (ближе к локтю), рука опущена, ладонь смотрит вперёд, кулак не сжимай.',
    min: 15,
    max: 50,
  },
  thigh: {
    label: 'Бедро',
    hint: 'В самом толстом месте, у ягодичной складки. Стоишь, вес на обе ноги, мышцы расслаблены.',
    min: 30,
    max: 95,
  },
  calf: {
    label: 'Голень',
    hint: 'В самом толстом месте, стоя, вес на обе ноги, мышцы расслаблены.',
    min: 20,
    max: 60,
  },
};

const cm = (site: MeasureSite) =>
  z.number().min(MEASURE_INFO[site].min).max(MEASURE_INFO[site].max).optional();

export const measurementInputSchema = z
  .strictObject({
    date: z.iso.date().optional(),
    neck: cm('neck'),
    shoulders: cm('shoulders'),
    chest: cm('chest'),
    waist: cm('waist'),
    hips: cm('hips'),
    arm: cm('arm'),
    forearm: cm('forearm'),
    thigh: cm('thigh'),
    calf: cm('calf'),
  })
  .refine((v) => MEASURE_SITES.some((s) => v[s] !== undefined), {
    message: 'Впиши хотя бы один замер',
  });
export type MeasurementInput = z.infer<typeof measurementInputSchema>;

export interface MeasurementEntry {
  id: string;
  date: string;
  girths: Girths;
  /** Вес на момент замера, кг. */
  weightKg: number | null;
}

/**
 * none — замеров нет; due — пора перемерить; soon — скоро; ok — рано.
 * Тело за месяц меняется на 0,5–2 см, а лента врёт на 0,5 см, поэтому чаще 3–4 недель мерить нет смысла.
 */
export type MeasurementDueStatus = 'none' | 'due' | 'soon' | 'ok';

export interface MeasurementDue {
  status: MeasurementDueStatus;
  daysSince: number | null;
  message: string;
}

export interface MeasurementsResponse {
  /** Новые сверху. */
  entries: MeasurementEntry[];
  due: MeasurementDue;
}
