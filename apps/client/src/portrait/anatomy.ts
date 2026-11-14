import type { BodyZone, MuscleGroup, PortraitBody } from '@trektren/shared';

/**
 * Анатомическая фигура в SVG, собранная из данных человека.
 *
 * Шаблон — мужчина 180 см в лёгкой А-стойке, правая половина (x ≥ 100), левая — зеркало.
 * Каждая точка принадлежит части тела: голова, торс, рука или нога. Торс тянется по ширине
 * на своей высоте (шея, плечи, грудь, талия, таз); рука и нога — вдоль своей оси: ось
 * сдвигается шириной плеч и таза, толщина вокруг оси — своя.
 *
 * Мышца задаётся линией начала и линией прикрепления: волокна идут от одной к другой,
 * крайние волокна выгибаются наружу и дают брюшко. Так получается и веер (грудь, широчайшие),
 * и веретено (бицепс) — с настоящим направлением волокон.
 *
 * Кожа и мышцы считаются с разной толщиной: мышцы — по силовым, кожа — мышцы плюс жир.
 * Зазор между ними и есть жир: сушка — кожа прилегает, набор массы — мышцы толще.
 */

export type Part = 'head' | 'torso' | 'arm' | 'leg';
type P = readonly [number, number];
/** Точка шаблона; третий элемент — часть тела, если она не та, что у фигуры. */
type TP = readonly [number, number] | readonly [number, number, Part];
type Seg = readonly [TP, TP, TP];

export const GROUND = 422;
const CX = 100;

/** Каркас: одинаковый для кожи и мышц, иначе мышцы съедут с костей. */
export interface Frame {
  /** Ширина плечевого пояса и таза (пол). */
  shoulders: number;
  pelvis: number;
  /** Рост относительно 180 см. */
  height: number;
  /** Пока профиль не заполнен, человечек меньше: 0,6…1. */
  growth: number;
}

/** Толщина частей тела относительно шаблона. */
export interface Build {
  neck: number;
  delts: number;
  chest: number;
  waist: number;
  hips: number;
  arm: number;
  forearm: number;
  thigh: number;
  calf: number;
}

export interface Shape {
  frame: Frame;
  lean: Build;
  skin: Build;
  /** Уровни мышц 0…1 — от них брюшко мышцы. */
  levels: Record<MuscleGroup, number | null>;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const avg = (...v: Array<number | null>) => {
  const k = v.filter((x): x is number => x !== null);
  return k.length ? k.reduce((a, b) => a + b, 0) / k.length : null;
};

/**
 * Пропорции из данных: пол, рост, вес и жир, уровни мышц.
 * Без силовых мышцы средние (0,35), без процента жира — оценка сервера по ИМТ.
 */
export function shapeOf(body: PortraitBody, growth = 1): Shape {
  const female = body.sex === 'female';
  const lv = (m: MuscleGroup) => body.levels[m] ?? 0.35;
  // Мышцы: 0,5 — шаблон, сильнее — толще.
  const m = (level: number, k: number) => 1 + (level - 0.5) * k;
  const lean: Build = {
    neck: clamp(m(lv('traps'), 0.3), 0.85, 1.25),
    delts: clamp(m(lv('shoulders'), 0.28) * (female ? 0.9 : 1), 0.78, 1.25),
    chest: clamp(m(avg(lv('chest'), lv('back'))!, 0.22) * (female ? 0.92 : 1), 0.8, 1.2),
    waist: clamp(m(lv('abs'), 0.08) * (female ? 0.88 : 1), 0.8, 1.1),
    hips: clamp(m(lv('glutes'), 0.12) * (female ? 1.08 : 1), 0.85, 1.25),
    arm: clamp(m(avg(lv('biceps'), lv('triceps'))!, 0.5) * (female ? 0.86 : 1), 0.72, 1.3),
    forearm: clamp(m(lv('forearms'), 0.36) * (female ? 0.88 : 1), 0.75, 1.25),
    thigh: clamp(m(avg(lv('quads'), lv('hamstrings'))!, 0.4) * (female ? 0.96 : 1), 0.78, 1.3),
    calf: clamp(m(lv('calves'), 0.32), 0.8, 1.25),
  };
  // Жир сверх сухого: у мужчин копится на животе, у женщин — на бёдрах и ягодицах.
  const fat = Math.max(0, (body.bodyFatPct - (female ? 16 : 9)) / 10);
  const add = (k: number) => 1 + fat * k;
  const skin: Build = {
    neck: lean.neck * add(0.08),
    delts: lean.delts * add(0.04),
    chest: lean.chest * add(female ? 0.07 : 0.07),
    waist: lean.waist * add(female ? 0.12 : 0.2),
    hips: lean.hips * add(female ? 0.15 : 0.09),
    arm: lean.arm * add(0.15),
    forearm: lean.forearm * add(0.06),
    thigh: lean.thigh * add(female ? 0.18 : 0.12),
    calf: lean.calf * add(0.06),
  };
  return {
    frame: {
      shoulders: female ? 0.9 : 1,
      pelvis: female ? 1.06 : 1,
      height: clamp(body.heightCm / 180, 0.8, 1.2),
      growth: clamp(growth, 0.5, 1),
    },
    lean,
    skin,
    levels: body.levels,
  };
}

/** Плоский список чисел — для плавного перехода между формами. */
export function flatten(s: Shape): number[] {
  const b = (x: Build) => [
    x.neck,
    x.delts,
    x.chest,
    x.waist,
    x.hips,
    x.arm,
    x.forearm,
    x.thigh,
    x.calf,
  ];
  return [
    s.frame.shoulders,
    s.frame.pelvis,
    s.frame.height,
    s.frame.growth,
    ...b(s.lean),
    ...b(s.skin),
  ];
}

export function unflatten(v: number[], levels: Shape['levels']): Shape {
  const b = (o: number): Build => ({
    neck: v[o]!,
    delts: v[o + 1]!,
    chest: v[o + 2]!,
    waist: v[o + 3]!,
    hips: v[o + 4]!,
    arm: v[o + 5]!,
    forearm: v[o + 6]!,
    thigh: v[o + 7]!,
    calf: v[o + 8]!,
  });
  return {
    frame: { shoulders: v[0]!, pelvis: v[1]!, height: v[2]!, growth: v[3]! },
    lean: b(4),
    skin: b(13),
    levels,
  };
}

/* Перенос точки шаблона на фигуру ------------------------------------------- */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Ширина торса на высоте y. */
function torsoFactor(y: number, f: Frame, b: Build): number {
  const shoulders = f.shoulders * b.delts;
  const hips = f.pelvis * b.hips;
  const table: Array<[number, number]> = [
    [60, b.neck],
    [74, b.neck],
    [84, shoulders],
    [100, (shoulders + b.chest) / 2],
    [122, b.chest],
    [158, (b.chest + b.waist) / 2],
    [182, b.waist],
    [206, hips],
    [240, hips],
  ];
  if (y <= table[0]![0]) return table[0]![1];
  for (let i = 1; i < table.length; i += 1) {
    const [y1, f1] = table[i]!;
    const [y0, f0] = table[i - 1]!;
    if (y <= y1) return lerp(f0, f1, (y - y0) / (y1 - y0));
  }
  return table[table.length - 1]![1];
}

// Оси конечностей в шаблоне: плечевой сустав → запястье, тазобедренный → голеностоп.
const ARM_A: P = [146, 94];
const ARM_B: P = [166, 224];
const LEG_A: P = [120, 214];
const LEG_B: P = [117, 402];

function alongAxis([x, y]: P, a: P, b: P) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const s = ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy);
  const fx = a[0] + vx * s;
  const fy = a[1] + vy * s;
  return { s, fx, fy, dx: x - fx, dy: y - fy };
}

export function place(p: TP, part: Part, f: Frame, b: Build): P {
  const where = (p.length === 3 ? p[2] : part) as Part;
  const x0 = p[0];
  const y0 = p[1];
  let x = x0;
  const y = y0;
  if (where === 'torso') {
    x = CX + (x0 - CX) * torsoFactor(y0, f, b);
  } else if (where === 'arm') {
    const { s, fx, fy, dx, dy } = alongAxis([x0, y0], ARM_A, ARM_B);
    // Рука висит на плечевом поясе: шире плечи — дальше от тела.
    const shift = (ARM_A[0] - CX) * (f.shoulders * b.delts - 1);
    const k = s < 0.4 ? b.arm : s > 0.62 ? b.forearm : lerp(b.arm, b.forearm, (s - 0.4) / 0.22);
    // Дельта сверху (s < 0) — по ширине дельт.
    const thick = s < 0.12 ? lerp(b.delts, k, clamp(s / 0.12, 0, 1)) : k;
    x = fx + shift + dx * thick;
    return finish([x, fy + dy * thick], f);
  } else if (where === 'leg') {
    const { s, fx, fy, dx, dy } = alongAxis([x0, y0], LEG_A, LEG_B);
    const shift = (LEG_A[0] - CX) * (f.pelvis * b.hips - 1);
    const k = s < 0.5 ? b.thigh : s > 0.6 ? b.calf : lerp(b.thigh, b.calf, (s - 0.5) / 0.1);
    x = Math.max(CX + 0.5, fx + shift + dx * k);
    return finish([x, fy + dy * k], f);
  }
  return finish([x, y], f);
}

function finish([x, y]: P, f: Frame): P {
  const k = f.height * f.growth;
  return [CX + (x - CX) * k, GROUND - (GROUND - y) * k];
}

const mirror = ([x, y]: P): P => [2 * CX - x, y];
const n1 = (n: number) => Math.round(n * 10) / 10;
const pt = ([x, y]: P) => `${n1(x)} ${n1(y)}`;

/* Силуэт ----------------------------------------------------------------- */

interface Outline {
  part: Part;
  start: TP;
  segs: readonly Seg[];
  /** Симметричная фигура: правая половина + зеркальная левая (голова, шея, торс). */
  symmetric?: boolean;
}

const HEAD: Outline = {
  part: 'head',
  symmetric: true,
  start: [100, 13],
  segs: [
    [
      [111, 13],
      [118, 21],
      [118, 34],
    ],
    [
      [118, 45],
      [116, 53],
      [111, 58],
    ],
    [
      [107, 62],
      [104, 64],
      [100, 64],
    ],
  ],
};

const NECK: Outline = {
  part: 'torso',
  symmetric: true,
  start: [100, 52],
  segs: [
    [
      [106, 52],
      [109, 54],
      [109, 58],
    ],
    [
      [109, 66],
      [110, 72],
      [113, 78],
    ],
    [
      [109, 82],
      [105, 84],
      [100, 84],
    ],
  ],
};

const TORSO: Outline = {
  part: 'torso',
  symmetric: true,
  start: [100, 74],
  segs: [
    [
      [106, 74],
      [110, 74],
      [112, 75],
    ],
    [
      [122, 79],
      [135, 81],
      [146, 84],
    ],
    [
      [150, 86],
      [151, 92],
      [149, 98],
    ],
    [
      [146, 108],
      [140, 116],
      [136, 122],
    ],
    [
      [136, 140],
      [133, 160],
      [131, 180],
    ],
    [
      [132, 190],
      [137, 200],
      [139, 212],
    ],
    [
      [140, 224],
      [134, 234],
      [122, 238],
    ],
    [
      [112, 240],
      [104, 238],
      [100, 236],
    ],
  ],
};

const ARM: Outline = {
  part: 'arm',
  start: [146, 84],
  segs: [
    [
      [155, 86],
      [160, 94],
      [160, 106],
    ],
    [
      [161, 122],
      [163, 140],
      [164, 156],
    ],
    [
      [165, 162],
      [166, 166],
      [167, 170],
    ],
    [
      [171, 186],
      [173, 204],
      [172, 222],
    ],
    [
      [176, 232],
      [179, 246],
      [178, 258],
    ],
    [
      [177, 266],
      [169, 268],
      [166, 262],
    ],
    [
      [163, 254],
      [161, 244],
      [162, 232],
    ],
    [
      [161, 226],
      [160, 224],
      [159, 222],
    ],
    [
      [155, 206],
      [150, 190],
      [149, 174],
    ],
    [
      [148, 170],
      [147, 168],
      [146, 166],
    ],
    [
      [144, 150],
      [141, 134],
      [137, 122],
    ],
    [
      [136, 108],
      [138, 92],
      [146, 84],
    ],
  ],
};

const LEG: Outline = {
  part: 'leg',
  start: [110, 206],
  segs: [
    [
      [122, 203],
      [132, 203],
      [138, 208],
    ],
    [
      [142, 222],
      [143, 244],
      [141, 262],
    ],
    [
      [139, 284],
      [133, 302],
      [130, 314],
    ],
    [
      [132, 326],
      [135, 340],
      [134, 354],
    ],
    [
      [133, 372],
      [127, 390],
      [124, 402],
    ],
    [
      [127, 410],
      [131, 416],
      [130, 421],
    ],
    [
      [124, 423],
      [112, 423],
      [106, 421],
    ],
    [
      [105, 414],
      [108, 408],
      [110, 402],
    ],
    [
      [108, 388],
      [105, 368],
      [106, 350],
    ],
    [
      [107, 336],
      [109, 324],
      [109, 316],
    ],
    [
      [104, 298],
      [101, 272],
      [101, 244],
    ],
    [
      [101, 226],
      [104, 212],
      [110, 206],
    ],
  ],
};

function outlinePath(o: Outline, s: Shape, flip: boolean): string {
  const map = (p: TP) => {
    const q = place(p, o.part, s.frame, s.skin);
    return flip ? mirror(q) : q;
  };
  const pts = [o.start, ...o.segs.flatMap((seg) => seg)].map(map);
  let d = `M${pt(pts[0]!)}`;
  for (let i = 1; i < pts.length; i += 3)
    d += `C${pt(pts[i]!)} ${pt(pts[i + 1]!)} ${pt(pts[i + 2]!)}`;
  if (o.symmetric) {
    const left = pts.map(mirror);
    for (let i = left.length - 1; i > 0; i -= 3)
      d += `C${pt(left[i - 1]!)} ${pt(left[i - 2]!)} ${pt(left[i - 3]!)}`;
  }
  return `${d}Z`;
}

/** Части кожи: голова, шея, торс, руки, ноги. Рисуются слоями, чтобы швы не были видны. */
export function skinParts(s: Shape): string[] {
  return [
    outlinePath(LEG, s, false),
    outlinePath(LEG, s, true),
    outlinePath(ARM, s, false),
    outlinePath(ARM, s, true),
    outlinePath(TORSO, s, false),
    outlinePath(NECK, s, false),
    outlinePath(HEAD, s, false),
  ];
}

/** Уши — мелочь, но без них голова — яйцо. */
export function ears(s: Shape) {
  const [x, y] = place([117.5, 38], 'head', s.frame, s.skin);
  const k = s.frame.height * s.frame.growth;
  return [
    { cx: x, cy: y, rx: 2.6 * k, ry: 6 * k },
    { cx: 2 * CX - x, cy: y, rx: 2.6 * k, ry: 6 * k },
  ];
}

/** Макушка — для отметки роста. */
export const crownY = (s: Shape) => GROUND - (GROUND - 13) * s.frame.height * s.frame.growth;

/* Мышцы ------------------------------------------------------------------ */

export interface MuscleDef {
  id: string;
  /** Анатомическое название — в подсказке и в составе группы. */
  name: string;
  /** null — не мышца (сухожилие): не нажимается. */
  group: MuscleGroup | null;
  part: Part;
  origin: readonly TP[];
  insertion: readonly TP[];
  /** Выпуклость крайних волокон при среднем уровне. */
  bulge: number;
  fibers: number;
}

/** Точки парами чисел; part — если линия лежит на другой части тела. */
const pts = (flat: number[], part?: Part): TP[] => {
  const out: TP[] = [];
  for (let i = 0; i < flat.length; i += 2)
    out.push(part ? [flat[i]!, flat[i + 1]!, part] : [flat[i]!, flat[i + 1]!]);
  return out;
};

function mus(
  id: string,
  name: string,
  group: MuscleGroup | null,
  part: Part,
  origin: number[],
  insertion: number[],
  bulge: number,
  fibers: number,
  parts: { o?: Part; i?: Part } = {},
): MuscleDef {
  return {
    id,
    name,
    group,
    part,
    origin: pts(origin, parts.o),
    insertion: pts(insertion, parts.i),
    bulge,
    fibers,
  };
}

/* Мышцы, общие для обеих сторон: дельта сбоку видна и спереди, и сзади. */
const DELT_LATERAL = mus(
  'delt-lateral',
  'Дельтовидная, средний пучок',
  'shoulders',
  'arm',
  [146, 84, 154, 88, 158.5, 97],
  [155, 127, 157.5, 129],
  2.8,
  7,
);

const serratus = (i: number) =>
  mus(
    `serratus-${i}`,
    'Передняя зубчатая',
    'abs',
    'torso',
    [136, 126 + i * 8, 136.5, 131 + i * 8],
    [128, 132 + i * 8, 128, 136 + i * 8],
    0.8,
    3,
  );

const absRow = (i: number, y0: number, y1: number, x1: number, x1b = x1) =>
  mus(
    `abs-${i}`,
    'Прямая мышца живота',
    'abs',
    'torso',
    [101.2, y0, x1, y0],
    [101.2, y1, x1b, y1],
    1.1,
    4,
  );

/** Вид спереди. Порядок — от глубоких к поверхностным: позже нарисованная лежит сверху. */
export const FRONT: MuscleDef[] = [
  // Шея и трапеции
  mus(
    'scm',
    'Грудино-ключично-сосцевидная',
    'traps',
    'torso',
    [111.5, 47, 114, 51],
    [101.5, 80, 108, 81],
    1,
    4,
  ),
  mus(
    'traps-front',
    'Трапециевидная, верхняя часть',
    'traps',
    'torso',
    [109.5, 62, 111.5, 73],
    [126, 80, 142, 83],
    1.2,
    6,
  ),
  // Кор
  serratus(0),
  serratus(1),
  serratus(2),
  serratus(3),
  mus(
    'obliques',
    'Наружная косая',
    'abs',
    'torso',
    [131, 146, 133, 170, 134, 196],
    [121, 158, 123, 184, 127, 208],
    1.6,
    8,
  ),
  absRow(1, 140, 156, 118),
  absRow(2, 158, 174, 119),
  absRow(3, 176, 192, 119),
  absRow(4, 194, 228, 119, 108),
  // Грудь
  mus(
    'pec-sternal',
    'Большая грудная, грудинная часть',
    'chest',
    'torso',
    [101, 89, 101, 112, 103, 137],
    [141, 108, 142, 116],
    4.5,
    12,
    { i: 'arm' },
  ),
  mus(
    'pec-clavicular',
    'Большая грудная, ключичная часть',
    'chest',
    'torso',
    [102, 84, 129, 85],
    [141, 101, 142, 107],
    2,
    8,
    { i: 'arm' },
  ),
  // Плечо
  mus(
    'triceps-medial-front',
    'Трицепс, медиальная головка',
    'triceps',
    'arm',
    [137.6, 124, 140.5, 120],
    [146, 160, 148, 163],
    1.4,
    3,
  ),
  mus(
    'brachialis',
    'Плечевая мышца',
    'biceps',
    'arm',
    [158.5, 128, 161.5, 138],
    [155.5, 166, 158, 168],
    1.6,
    4,
  ),
  mus(
    'biceps-short',
    'Бицепс, короткая головка',
    'biceps',
    'arm',
    [141, 113, 145.5, 111],
    [151.5, 162, 154, 163],
    3.6,
    5,
  ),
  mus(
    'biceps-long',
    'Бицепс, длинная головка',
    'biceps',
    'arm',
    [146, 110, 151, 108],
    [154, 162, 156.5, 163],
    3.6,
    5,
  ),
  mus(
    'delt-anterior',
    'Дельтовидная, передний пучок',
    'shoulders',
    'arm',
    [132, 84, 146, 84],
    [152.5, 126, 155, 128],
    3.5,
    7,
  ),
  DELT_LATERAL,
  // Предплечье
  mus(
    'flexor-carpi-ulnaris',
    'Локтевой сгибатель запястья',
    'forearms',
    'arm',
    [147.5, 170, 150, 171],
    [158.8, 222, 160.8, 222],
    1.3,
    3,
  ),
  mus(
    'flexor-carpi-radialis',
    'Лучевой сгибатель запястья',
    'forearms',
    'arm',
    [150, 170, 153.5, 170],
    [161.5, 222, 164, 222],
    2,
    4,
  ),
  mus(
    'pronator-teres',
    'Круглый пронатор',
    'forearms',
    'arm',
    [148.5, 166, 152, 165],
    [160, 192, 163.5, 194],
    1.5,
    4,
  ),
  mus(
    'brachioradialis',
    'Плечелучевая',
    'forearms',
    'arm',
    [159.5, 146, 165, 158],
    [165, 214, 170.5, 216],
    3.4,
    5,
  ),
  // Бедро: приводящие (внутри), квадрицепс (спереди), напрягатель фасции (сбоку)
  mus(
    'gracilis',
    'Тонкая',
    'adductors',
    'leg',
    [101.2, 234, 103, 232],
    [105.5, 306, 107.5, 307],
    1,
    3,
  ),
  mus(
    'adductor-longus',
    'Длинная приводящая',
    'adductors',
    'leg',
    [101.8, 230, 106, 227],
    [106, 280, 110, 268],
    2,
    5,
  ),
  mus(
    'pectineus',
    'Гребенчатая',
    'adductors',
    'leg',
    [106, 224, 113, 222],
    [109, 246, 113, 243],
    1,
    3,
  ),
  mus(
    'vastus-lateralis',
    'Латеральная широкая',
    'quads',
    'leg',
    [134, 212, 141, 232],
    [125, 300, 131, 307],
    4.5,
    8,
  ),
  mus(
    'vastus-medialis',
    'Медиальная широкая',
    'quads',
    'leg',
    [104, 268, 112, 250],
    [109, 307, 118, 303],
    6,
    7,
  ),
  mus(
    'rectus-femoris',
    'Прямая мышца бедра',
    'quads',
    'leg',
    [118, 212, 128, 212],
    [115, 296, 124, 297],
    6,
    9,
  ),
  mus(
    'sartorius',
    'Портняжная',
    'quads',
    'leg',
    [128, 208, 131.5, 210.5],
    [108, 304, 110.5, 306],
    1.2,
    2,
  ),
  mus(
    'tfl',
    'Напрягатель широкой фасции',
    'glutes',
    'torso',
    [131, 204, 138, 208],
    [136, 234, 140, 238],
    2,
    4,
    { i: 'leg' },
  ),
  // Голень
  mus(
    'soleus-medial-front',
    'Камбаловидная',
    'calves',
    'leg',
    [106, 368, 108, 358],
    [110.5, 394, 113, 396],
    1.2,
    3,
  ),
  mus(
    'gastroc-medial-front',
    'Икроножная, медиальная головка',
    'calves',
    'leg',
    [106.5, 322, 113, 318],
    [107.5, 368, 112, 374],
    4,
    5,
  ),
  mus(
    'peroneus',
    'Длинная малоберцовая',
    'calves',
    'leg',
    [130, 328, 133.5, 340],
    [122.5, 390, 125.5, 391],
    2,
    4,
  ),
  mus(
    'ext-digitorum-longus',
    'Длинный разгибатель пальцев',
    'calves',
    'leg',
    [127.5, 328, 130.5, 334],
    [119, 394, 121.5, 396],
    1.2,
    3,
  ),
  mus(
    'tibialis',
    'Передняя большеберцовая',
    'calves',
    'leg',
    [120, 321, 128, 325],
    [114, 393, 118.5, 395],
    3.2,
    5,
  ),
];

/** Вид сзади. */
export const BACK: MuscleDef[] = [
  // Спина
  mus(
    'erectors',
    'Разгибатели спины',
    'back',
    'torso',
    [101, 234, 109, 232],
    [101, 140, 105, 140],
    1.6,
    3,
  ),
  mus(
    'obliques-back',
    'Наружная косая',
    'abs',
    'torso',
    [133, 158, 134.5, 194],
    [127, 180, 128, 206],
    1.4,
    4,
  ),
  mus(
    'lats',
    'Широчайшая',
    'back',
    'torso',
    [104, 128, 108, 176, 126, 204],
    [136, 117, 138.5, 124],
    3.5,
    14,
    { i: 'arm' },
  ),
  mus(
    'teres-major',
    'Большая круглая',
    'back',
    'torso',
    [117, 124, 124, 130],
    [137, 111, 138, 117],
    1.8,
    4,
    { i: 'arm' },
  ),
  mus(
    'teres-minor',
    'Малая круглая',
    'back',
    'torso',
    [123, 117, 128, 120],
    [138.5, 104, 140, 108],
    1.2,
    3,
    { i: 'arm' },
  ),
  mus(
    'infraspinatus',
    'Подостная',
    'back',
    'torso',
    [110, 100, 114, 124],
    [136, 100, 138, 108],
    2.4,
    6,
  ),
  // Трапеции
  mus(
    'traps-lower',
    'Трапециевидная, нижняя часть',
    'traps',
    'torso',
    [100.5, 106, 100.5, 142],
    [116, 100, 122, 96],
    1.6,
    7,
  ),
  mus(
    'traps-middle',
    'Трапециевидная, средняя часть',
    'traps',
    'torso',
    [100.5, 82, 100.5, 104],
    [124, 92, 140, 89],
    1,
    6,
  ),
  mus(
    'traps-upper',
    'Трапециевидная, верхняя часть',
    'traps',
    'torso',
    [100.5, 58, 100.5, 80],
    [126, 81, 146, 85],
    1.4,
    8,
  ),
  // Плечо
  mus(
    'triceps-medial',
    'Трицепс, медиальная головка',
    'triceps',
    'arm',
    [146, 140, 152, 138],
    [150, 163, 155, 164],
    1.2,
    3,
  ),
  mus(
    'triceps-long',
    'Трицепс, длинная головка',
    'triceps',
    'arm',
    [138, 114, 145, 110],
    [148, 161, 154, 163],
    5,
    7,
  ),
  mus(
    'triceps-lateral',
    'Трицепс, латеральная головка',
    'triceps',
    'arm',
    [152, 110, 159.5, 117],
    [155, 150, 158, 159],
    4,
    6,
  ),
  DELT_LATERAL,
  mus(
    'delt-rear',
    'Дельтовидная, задний пучок',
    'shoulders',
    'arm',
    [128, 90, 146, 86, 152, 90],
    [153, 127, 155.5, 129],
    4,
    8,
  ),
  // Предплечье
  mus(
    'ext-carpi-ulnaris',
    'Локтевой разгибатель запястья',
    'forearms',
    'arm',
    [148, 171, 152, 169],
    [159.5, 222, 162, 222],
    1.8,
    3,
  ),
  mus(
    'ext-digitorum',
    'Разгибатель пальцев',
    'forearms',
    'arm',
    [153.5, 168, 158, 167],
    [163, 222, 166, 222],
    2.2,
    4,
  ),
  mus(
    'ext-carpi-radialis',
    'Лучевой разгибатель запястья',
    'forearms',
    'arm',
    [159, 166, 163.5, 168],
    [167, 222, 170.5, 222],
    2.4,
    4,
  ),
  mus(
    'brachioradialis-back',
    'Плечелучевая',
    'forearms',
    'arm',
    [160, 146, 165, 156],
    [167, 210, 171, 214],
    2.2,
    4,
  ),
  // Бедро сзади: приводящие, бицепс бедра; ягодицы — поверх
  mus(
    'adductor-magnus',
    'Большая приводящая',
    'adductors',
    'leg',
    [102, 244, 107, 244],
    [104, 288, 107.5, 280],
    1.6,
    4,
  ),
  mus(
    'gracilis-back',
    'Тонкая',
    'adductors',
    'leg',
    [101.2, 252, 102.6, 250],
    [105.6, 307, 107.4, 309],
    0.8,
    2,
  ),
  mus(
    'semimembranosus',
    'Полуперепончатая',
    'hamstrings',
    'leg',
    [104, 262, 110, 258],
    [106, 308, 111, 309],
    3,
    4,
  ),
  mus(
    'semitendinosus',
    'Полусухожильная',
    'hamstrings',
    'leg',
    [110, 250, 117, 250],
    [110, 306, 114, 308],
    3.5,
    5,
  ),
  mus(
    'biceps-femoris',
    'Двуглавая мышца бедра',
    'hamstrings',
    'leg',
    [118, 250, 127, 248],
    [127, 306, 134, 309],
    5,
    7,
  ),
  mus(
    'glute-medius',
    'Средняя ягодичная',
    'glutes',
    'torso',
    [114, 199, 136, 202],
    [137, 216, 140, 224],
    2.4,
    7,
  ),
  mus(
    'glute-max',
    'Большая ягодичная',
    'glutes',
    'torso',
    [128, 203, 112, 204, 102, 214, 101.5, 240],
    [141, 232, 133, 258],
    8,
    13,
    { i: 'leg' },
  ),
  // Голень
  mus(
    'soleus-medial',
    'Камбаловидная',
    'calves',
    'leg',
    [106, 362, 108, 352],
    [113, 394, 115, 396],
    1.3,
    3,
  ),
  mus(
    'soleus',
    'Камбаловидная',
    'calves',
    'leg',
    [128.5, 352, 132, 362],
    [121, 394, 124, 394],
    1.4,
    3,
  ),
  mus(
    'peroneus-back',
    'Длинная малоберцовая',
    'calves',
    'leg',
    [130, 330, 133.5, 342],
    [124, 392, 126, 394],
    1.4,
    3,
  ),
  mus(
    'gastroc-lateral',
    'Икроножная, латеральная головка',
    'calves',
    'leg',
    [120, 314, 131, 317],
    [118, 372, 123, 373],
    5.5,
    7,
  ),
  mus(
    'gastroc-medial',
    'Икроножная, медиальная головка',
    'calves',
    'leg',
    [106.5, 318, 117, 314],
    [113, 377, 118, 377],
    6.5,
    7,
  ),
  mus(
    'achilles',
    'Ахиллово сухожилие',
    null,
    'leg',
    [114.5, 374, 119, 374],
    [116, 403, 118.5, 403],
    0.3,
    2,
  ),
];

/** Из каких мышц состоит группа — по названиям, без повторов. */
export function partsOf(group: MuscleGroup): string[] {
  return [...new Set([...FRONT, ...BACK].filter((d) => d.group === group).map((d) => d.name))];
}

type V = [number, number];
const sub = (a: P, b: P): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: P, b: P): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P, k: number): V => [a[0] * k, a[1] * k];
const len = (a: P) => Math.hypot(a[0], a[1]);
const unit = (a: P): V => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const mid = (a: P, b: P): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** Точка на ломаной по доле длины 0…1. */
function along(points: P[], t: number): P {
  if (points.length === 1) return points[0]!;
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const l = len(sub(points[i]!, points[i - 1]!));
    lens.push(l);
    total += l;
  }
  let target = t * total;
  for (let i = 0; i < lens.length; i += 1) {
    if (target <= lens[i]! || i === lens.length - 1) {
      const k = lens[i]! ? Math.min(1, target / lens[i]!) : 0;
      return add(points[i]!, mul(sub(points[i + 1]!, points[i]!), k));
    }
    target -= lens[i]!;
  }
  return points[points.length - 1]!;
}

/** Гладкая ломаная (Catmull-Rom → кривые Безье), без первой команды M. */
function smooth(points: P[]): string {
  if (points.length < 3)
    return points
      .slice(1)
      .map((p) => `L${pt(p)}`)
      .join('');
  let d = '';
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1 = add(p1, mul(sub(p2, p0), 1 / 6));
    const c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d;
}

export interface MuscleGeometry {
  id: string;
  name: string;
  group: MuscleGroup | null;
  outline: string;
  fibers: string;
  /** Центр брюшка — для метки приоритета. */
  center: P;
}

/** Мышца на фигуре: контур и волокна. Брюшко тем выпуклее, чем мышца сильнее. */
export function muscleGeometry(def: MuscleDef, s: Shape, flip: boolean): MuscleGeometry {
  const map = (p: TP) => {
    const q = place(p, def.part, s.frame, s.lean);
    return flip ? mirror(q) : q;
  };
  const O = def.origin.map(map);
  const I = def.insertion.map(map);
  const level = def.group ? (s.levels[def.group] ?? 0.35) : 0.4;
  const scale = s.frame.height * s.frame.growth;
  const bulge = def.bulge * scale * (0.7 + 0.6 * level);

  const o0 = along(O, 0);
  const i0 = along(I, 0);
  const o1 = along(O, 1);
  const i1 = along(I, 1);
  // Наружу — от последнего волокна к первому.
  const outward = unit(sub(mid(o0, i0), mid(o1, i1)));
  const control = (t: number): P => {
    const a = along(O, t);
    const b = along(I, t);
    const dir = unit(sub(b, a));
    let normal: V = [-dir[1], dir[0]];
    if (normal[0] * outward[0] + normal[1] * outward[1] < 0) normal = mul(normal, -1);
    return add(mid(a, b), mul(normal, bulge * (1 - 2 * t)));
  };

  const c0 = control(0);
  const c1 = control(1);
  const outline =
    `M${pt(o0)}Q${pt(c0)} ${pt(i0)}` +
    smooth(I) +
    `Q${pt(c1)} ${pt(o1)}` +
    smooth([...O].reverse()) +
    'Z';

  let fibers = '';
  for (let k = 1; k < def.fibers; k += 1) {
    const t = k / def.fibers;
    fibers += `M${pt(along(O, t))}Q${pt(control(t))} ${pt(along(I, t))}`;
  }
  const centerPts = [o0, i0, o1, i1, mid(c0, c1)];
  const center: P = [
    centerPts.reduce((a, p) => a + p[0], 0) / centerPts.length,
    centerPts.reduce((a, p) => a + p[1], 0) / centerPts.length,
  ];
  return {
    id: `${def.id}${flip ? '-l' : '-r'}`,
    name: def.name,
    group: def.group,
    outline,
    fibers,
    center,
  };
}

/* Детали: ключицы, белая линия живота, наколенники ------------------------- */

export function frontDetails(s: Shape): string {
  const m = (p: TP, part: Part) => place(p, part, s.frame, s.lean);
  const clav = [m([102, 82], 'torso'), m([124, 80.5], 'torso'), m([145, 84], 'torso')];
  const right = `M${pt(clav[0]!)}Q${pt(clav[1]!)} ${pt(clav[2]!)}`;
  const left = `M${pt(mirror(clav[0]!))}Q${pt(mirror(clav[1]!))} ${pt(mirror(clav[2]!))}`;
  return `${right}${left}`;
}

export function kneecaps(s: Shape) {
  const [x, y] = place([119.5, 311], 'leg', s.frame, s.lean);
  const k = s.frame.height * s.frame.growth;
  return [
    { cx: x, cy: y, rx: 5.2 * k * s.lean.thigh, ry: 7 * k },
    { cx: 2 * CX - x, cy: y, rx: 5.2 * k * s.lean.thigh, ry: 7 * k },
  ];
}

/* Травмы ----------------------------------------------------------------- */

const ZONE_AT: Record<BodyZone, { at: TP; part: Part; view: 'front' | 'back' }> = {
  neck: { at: [104, 68], part: 'torso', view: 'front' },
  shoulder: { at: [150, 96], part: 'arm', view: 'front' },
  elbow: { at: [157, 168], part: 'arm', view: 'back' },
  wrist: { at: [166, 224], part: 'arm', view: 'front' },
  chest: { at: [118, 104], part: 'torso', view: 'front' },
  lowerBack: { at: [100, 200], part: 'torso', view: 'back' },
  hip: { at: [136, 224], part: 'torso', view: 'front' },
  knee: { at: [119.5, 311], part: 'leg', view: 'front' },
  ankle: { at: [118, 402], part: 'leg', view: 'front' },
};

export function injuryPoint(zone: BodyZone, s: Shape) {
  const z = ZONE_AT[zone];
  return { view: z.view, at: place(z.at, z.part, s.frame, s.skin) };
}
