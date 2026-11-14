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
  /** null — анатомическая деталь без своей группы (приводящие, ахилл): не нажимается. */
  group: MuscleGroup | null;
  part: Part;
  origin: readonly TP[];
  insertion: readonly TP[];
  /** Выпуклость крайних волокон при среднем уровне. */
  bulge: number;
  fibers: number;
}

const serratus = (i: number): MuscleDef => ({
  id: `serratus-${i}`,
  group: 'abs',
  part: 'torso',
  origin: [
    [136, 126 + i * 9],
    [136.5, 132 + i * 9],
  ],
  insertion: [
    [128, 133 + i * 9],
    [128, 137 + i * 9],
  ],
  bulge: 0.8,
  fibers: 3,
});

const absRow = (i: number, y0: number, y1: number, x1: number, x1b = x1): MuscleDef => ({
  id: `abs-${i}`,
  group: 'abs',
  part: 'torso',
  origin: [
    [101.2, y0],
    [x1, y0],
  ],
  insertion: [
    [101.2, y1],
    [x1b, y1],
  ],
  bulge: 1.1,
  fibers: 4,
});

export const FRONT: MuscleDef[] = [
  {
    id: 'adductors',
    group: null,
    part: 'leg',
    origin: [
      [101.5, 236],
      [110, 216],
    ],
    insertion: [
      [104, 280],
      [110, 266],
    ],
    bulge: 3,
    fibers: 6,
  },
  {
    id: 'traps-front',
    group: 'traps',
    part: 'torso',
    origin: [
      [109.5, 62],
      [111.5, 73],
    ],
    insertion: [
      [126, 80],
      [142, 83],
    ],
    bulge: 1.2,
    fibers: 6,
  },
  serratus(0),
  serratus(1),
  serratus(2),
  {
    id: 'obliques',
    group: 'abs',
    part: 'torso',
    origin: [
      [131, 146],
      [133, 170],
      [134, 196],
    ],
    insertion: [
      [121, 158],
      [123, 184],
      [127, 208],
    ],
    bulge: 1.6,
    fibers: 8,
  },
  absRow(1, 140, 156, 118),
  absRow(2, 158, 174, 119),
  absRow(3, 176, 192, 119),
  absRow(4, 194, 228, 119, 108),
  {
    id: 'pec-sternal',
    group: 'chest',
    part: 'torso',
    origin: [
      [101, 89],
      [101, 112],
      [103, 137],
    ],
    insertion: [
      [141, 108, 'arm'],
      [142, 116, 'arm'],
    ],
    bulge: 4.5,
    fibers: 12,
  },
  {
    id: 'pec-clavicular',
    group: 'chest',
    part: 'torso',
    origin: [
      [102, 84],
      [129, 85],
    ],
    insertion: [
      [141, 101, 'arm'],
      [142, 107, 'arm'],
    ],
    bulge: 2,
    fibers: 8,
  },
  {
    id: 'delt-front',
    group: 'shoulders',
    part: 'arm',
    origin: [
      [133, 84],
      [146, 84],
      [154, 90],
    ],
    insertion: [
      [154, 127],
      [156, 129],
    ],
    bulge: 4.5,
    fibers: 10,
  },
  {
    id: 'biceps',
    group: 'biceps',
    part: 'arm',
    origin: [
      [142, 112],
      [148, 108],
    ],
    insertion: [
      [154, 163],
      [157, 163],
    ],
    bulge: 5.5,
    fibers: 7,
  },
  {
    id: 'brachioradialis',
    group: 'forearms',
    part: 'arm',
    origin: [
      [159.5, 146],
      [165, 158],
    ],
    insertion: [
      [165, 214],
      [170.5, 216],
    ],
    bulge: 3.6,
    fibers: 5,
  },
  {
    id: 'forearm-flexors',
    group: 'forearms',
    part: 'arm',
    origin: [
      [147.5, 168],
      [158, 171],
    ],
    insertion: [
      [160, 222],
      [166, 222],
    ],
    bulge: 4.2,
    fibers: 6,
  },
  {
    id: 'vastus-lateralis',
    group: 'quads',
    part: 'leg',
    origin: [
      [130, 210],
      [139, 230],
    ],
    insertion: [
      [124, 298],
      [131, 307],
    ],
    bulge: 4.5,
    fibers: 8,
  },
  {
    id: 'rectus-femoris',
    group: 'quads',
    part: 'leg',
    origin: [
      [117, 212],
      [128, 212],
    ],
    insertion: [
      [115, 296],
      [124, 296],
    ],
    bulge: 6.5,
    fibers: 9,
  },
  {
    id: 'vastus-medialis',
    group: 'quads',
    part: 'leg',
    origin: [
      [103, 264],
      [112, 250],
    ],
    insertion: [
      [109, 307],
      [118, 303],
    ],
    bulge: 6,
    fibers: 7,
  },
  {
    id: 'sartorius',
    group: 'quads',
    part: 'leg',
    origin: [
      [128, 209],
      [131.5, 211],
    ],
    insertion: [
      [108.5, 303],
      [111, 305],
    ],
    bulge: 1.2,
    fibers: 2,
  },
  {
    id: 'gastroc-medial-front',
    group: 'calves',
    part: 'leg',
    origin: [
      [106.5, 322],
      [113, 318],
    ],
    insertion: [
      [107.5, 370],
      [112, 375],
    ],
    bulge: 4,
    fibers: 5,
  },
  {
    id: 'peroneus',
    group: 'calves',
    part: 'leg',
    origin: [
      [129.5, 326],
      [133, 338],
    ],
    insertion: [
      [122.5, 390],
      [125.5, 391],
    ],
    bulge: 2.4,
    fibers: 4,
  },
  {
    id: 'tibialis',
    group: 'calves',
    part: 'leg',
    origin: [
      [120, 321],
      [129, 325],
    ],
    insertion: [
      [114, 393],
      [118.5, 395],
    ],
    bulge: 3.5,
    fibers: 5,
  },
];

export const BACK: MuscleDef[] = [
  {
    id: 'erectors',
    group: 'back',
    part: 'torso',
    origin: [
      [101, 234],
      [109, 232],
    ],
    insertion: [
      [101, 140],
      [105, 140],
    ],
    bulge: 1.6,
    fibers: 3,
  },
  {
    id: 'lats',
    group: 'back',
    part: 'torso',
    origin: [
      [104, 128],
      [108, 176],
      [126, 204],
    ],
    insertion: [
      [136, 117, 'arm'],
      [138.5, 124, 'arm'],
    ],
    bulge: 3.5,
    fibers: 14,
  },
  {
    id: 'teres',
    group: 'back',
    part: 'torso',
    origin: [
      [117, 124],
      [124, 130],
    ],
    insertion: [
      [137, 111, 'arm'],
      [138, 117, 'arm'],
    ],
    bulge: 1.8,
    fibers: 4,
  },
  {
    id: 'infraspinatus',
    group: 'back',
    part: 'torso',
    origin: [
      [110, 100],
      [114, 124],
    ],
    insertion: [
      [136, 100],
      [138, 108],
    ],
    bulge: 2.4,
    fibers: 6,
  },
  {
    id: 'traps-lower',
    group: 'traps',
    part: 'torso',
    origin: [
      [100.5, 106],
      [100.5, 142],
    ],
    insertion: [
      [116, 100],
      [122, 96],
    ],
    bulge: 1.6,
    fibers: 7,
  },
  {
    id: 'traps-middle',
    group: 'traps',
    part: 'torso',
    origin: [
      [100.5, 82],
      [100.5, 104],
    ],
    insertion: [
      [124, 92],
      [140, 89],
    ],
    bulge: 1,
    fibers: 6,
  },
  {
    id: 'traps-upper',
    group: 'traps',
    part: 'torso',
    origin: [
      [100.5, 58],
      [100.5, 80],
    ],
    insertion: [
      [126, 81],
      [146, 85],
    ],
    bulge: 1.4,
    fibers: 8,
  },
  {
    id: 'delt-rear',
    group: 'shoulders',
    part: 'arm',
    origin: [
      [128, 90, 'torso'],
      [146, 86],
      [154, 92],
    ],
    insertion: [
      [154, 127],
      [156, 129],
    ],
    bulge: 4.5,
    fibers: 9,
  },
  {
    id: 'triceps-long',
    group: 'triceps',
    part: 'arm',
    origin: [
      [138, 114],
      [145, 110],
    ],
    insertion: [
      [148, 161],
      [154, 163],
    ],
    bulge: 5,
    fibers: 7,
  },
  {
    id: 'triceps-lateral',
    group: 'triceps',
    part: 'arm',
    origin: [
      [152, 110],
      [159.5, 117],
    ],
    insertion: [
      [155, 150],
      [158, 159],
    ],
    bulge: 4,
    fibers: 6,
  },
  {
    id: 'forearm-extensors',
    group: 'forearms',
    part: 'arm',
    origin: [
      [155, 166],
      [164, 167],
    ],
    insertion: [
      [165, 222],
      [170.5, 222],
    ],
    bulge: 4,
    fibers: 6,
  },
  {
    id: 'forearm-ulnar',
    group: 'forearms',
    part: 'arm',
    origin: [
      [147.5, 170],
      [154, 168],
    ],
    insertion: [
      [159.5, 222],
      [163, 222],
    ],
    bulge: 3.2,
    fibers: 4,
  },
  {
    id: 'glute-medius',
    group: 'glutes',
    part: 'torso',
    origin: [
      [114, 199],
      [136, 202],
    ],
    insertion: [
      [137, 216],
      [140, 224],
    ],
    bulge: 2.4,
    fibers: 7,
  },
  {
    id: 'glute-max',
    group: 'glutes',
    part: 'torso',
    origin: [
      [128, 203],
      [112, 204],
      [102, 214],
      [101.5, 240],
    ],
    insertion: [
      [141, 232, 'leg'],
      [133, 258, 'leg'],
    ],
    bulge: 8,
    fibers: 13,
  },
  {
    id: 'biceps-femoris',
    group: 'hamstrings',
    part: 'leg',
    origin: [
      [118, 250],
      [127, 248],
    ],
    insertion: [
      [127, 306],
      [134, 309],
    ],
    bulge: 6,
    fibers: 7,
  },
  {
    id: 'semitendinosus',
    group: 'hamstrings',
    part: 'leg',
    origin: [
      [103.5, 252],
      [117, 250],
    ],
    insertion: [
      [107, 307],
      [115, 309],
    ],
    bulge: 6,
    fibers: 7,
  },
  {
    id: 'soleus',
    group: 'calves',
    part: 'leg',
    origin: [
      [128.5, 352],
      [132, 362],
    ],
    insertion: [
      [121, 394],
      [124, 394],
    ],
    bulge: 1.4,
    fibers: 3,
  },
  {
    id: 'gastroc-lateral',
    group: 'calves',
    part: 'leg',
    origin: [
      [120, 314],
      [131, 317],
    ],
    insertion: [
      [118, 372],
      [123, 373],
    ],
    bulge: 5.5,
    fibers: 7,
  },
  {
    id: 'gastroc-medial',
    group: 'calves',
    part: 'leg',
    origin: [
      [106.5, 318],
      [117, 314],
    ],
    insertion: [
      [113, 377],
      [118, 377],
    ],
    bulge: 6.5,
    fibers: 7,
  },
  {
    id: 'achilles',
    group: null,
    part: 'leg',
    origin: [
      [114.5, 374],
      [119, 374],
    ],
    insertion: [
      [116, 403],
      [118.5, 403],
    ],
    bulge: 0.3,
    fibers: 2,
  },
];

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
  return { id: `${def.id}${flip ? '-l' : '-r'}`, group: def.group, outline, fibers, center };
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
