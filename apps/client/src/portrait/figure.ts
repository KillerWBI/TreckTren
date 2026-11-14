import type { BodyZone, MuscleGroup, PortraitBody } from '@trektren/shared';

/**
 * Фигура человека в SVG, собранная из параметров тела.
 *
 * Шаблон нарисован для мужчины 180 см со средними мышцами: правая половина фигуры
 * (x ≥ 100), левая получается зеркалом. Каждая точка шаблона растягивается по ширине
 * в зависимости от того, где она лежит: торс — по плечам, груди, талии и бёдрам; рука —
 * по ширине плеч (где висит) и толщине руки; нога — по ширине таза и толщине ноги.
 * Рост тянет фигуру вверх от земли.
 */

type Pt = readonly [number, number];
type Seg = readonly [Pt, Pt, Pt];
interface HalfShape {
  start: Pt;
  segs: readonly Seg[];
}

export interface BodyShape {
  neck: number;
  shoulders: number;
  chest: number;
  waist: number;
  hips: number;
  arms: number;
  legs: number;
  /** Рост относительно 180 см. */
  height: number;
  /** Рост человечка, пока профиль не заполнен: 0,6…1. */
  growth: number;
}

export const GROUND = 422;
const CX = 100;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const avg = (...v: Array<number | null>) => {
  const k = v.filter((x): x is number => x !== null);
  return k.length ? k.reduce((a, b) => a + b, 0) / k.length : null;
};

/** Ширины частей тела из пола, жира и уровней мышц. Пустой уровень — как у новичка. */
export function shapeOf(body: PortraitBody, growth = 1): BodyShape {
  const female = body.sex === 'female';
  const lv = (m: MuscleGroup) => body.levels[m] ?? 0.3;
  const fat = (body.bodyFatPct - (female ? 25 : 16)) / 10;
  const arm = avg(body.levels.biceps, body.levels.triceps) ?? 0.3;
  const leg = avg(body.levels.quads, body.levels.hamstrings) ?? 0.3;
  return {
    neck: clamp(0.94 + 0.16 * lv('traps') + 0.04 * fat, 0.8, 1.35),
    shoulders: clamp(
      (female ? 0.88 : 1) * (0.95 + 0.12 * lv('shoulders') + 0.05 * lv('back')) + 0.04 * fat,
      0.75,
      1.4,
    ),
    chest: clamp(
      (female ? 0.92 : 1) * (0.95 + 0.1 * lv('chest') + 0.05 * lv('back')) + 0.08 * fat,
      0.75,
      1.45,
    ),
    waist: clamp((female ? 0.86 : 1) * (0.94 + 0.03 * lv('abs')) + 0.13 * fat, 0.75, 1.6),
    hips: clamp((female ? 1.1 : 1) * (0.96 + 0.06 * lv('glutes')) + 0.08 * fat, 0.8, 1.55),
    arms: clamp(0.86 + 0.24 * arm + 0.08 * fat, 0.75, 1.45),
    legs: clamp(0.9 + 0.2 * leg + 0.08 * fat, 0.8, 1.45),
    height: clamp(body.heightCm / 180, 0.8, 1.2),
    growth: clamp(growth, 0.5, 1),
  };
}

export const SHAPE_KEYS = [
  'neck',
  'shoulders',
  'chest',
  'waist',
  'hips',
  'arms',
  'legs',
  'height',
  'growth',
] as const satisfies ReadonlyArray<keyof BodyShape>;

/** Ширина торса на высоте y: плавно от шеи к плечам, груди, талии и тазу. */
function torsoFactor(y: number, s: BodyShape): number {
  const table: Array<[number, number]> = [
    [62, s.neck],
    [72, s.neck],
    [84, s.shoulders],
    [114, s.shoulders],
    [132, s.chest],
    [170, (s.chest + s.waist) / 2],
    [198, s.waist],
    [226, s.hips],
    [244, s.hips],
  ];
  if (y <= table[0]![0]) return table[0]![1];
  for (let i = 1; i < table.length; i += 1) {
    const [y1, f1] = table[i]!;
    const [y0, f0] = table[i - 1]!;
    if (y <= y1) return f0 + ((f1 - f0) * (y - y0)) / (y1 - y0);
  }
  return table[table.length - 1]![1];
}

/** Точка шаблона → точка фигуры с этими параметрами (правая половина). */
function place([x, y]: Pt, s: BodyShape): Pt {
  let nx: number;
  if (y > 112 && x > 137 && y < 260) {
    // Рука: висит на ширине плеч, толщина — своя.
    const axis = y < 170 ? 150 : 152;
    nx = CX + (axis - CX) * s.shoulders + (x - axis) * s.arms;
  } else if (y >= 244) {
    // Нога: стоит на ширине таза, толщина — своя.
    const axis = 121;
    nx = CX + (axis - CX) * s.hips + (x - axis) * s.legs;
  } else {
    nx = CX + (x - CX) * torsoFactor(y, s);
  }
  nx = Math.max(CX, nx);
  const k = s.height * s.growth;
  return [CX + (nx - CX) * s.growth, GROUND - (GROUND - y) * k];
}

const f = (n: number) => n.toFixed(1);
const pt = ([x, y]: Pt) => `${f(x)} ${f(y)}`;
const mirror = ([x, y]: Pt): Pt => [2 * CX - x, y];

function halfPath(shape: HalfShape, s: BodyShape, flip: boolean): string {
  const map = (p: Pt) => (flip ? mirror(place(p, s)) : place(p, s));
  return (
    `M${pt(map(shape.start))}` +
    shape.segs.map(([a, b, c]) => `C${pt(map(a))} ${pt(map(b))} ${pt(map(c))}`).join('') +
    'Z'
  );
}

/** Обе половины мышцы: правая и зеркальная левая. */
export const musclePaths = (shape: HalfShape, s: BodyShape) =>
  [halfPath(shape, s, false), halfPath(shape, s, true)] as const;

/* Силуэт ----------------------------------------------------------------- */

const OUTLINE: HalfShape = {
  start: [110, 58],
  segs: [
    [
      [110.5, 64],
      [111, 68],
      [111, 72],
    ],
    [
      [125, 76],
      [138, 78],
      [146, 82],
    ],
    [
      [158, 86],
      [162, 100],
      [160, 116],
    ],
    [
      [162, 135],
      [163, 150],
      [161, 166],
    ],
    [
      [164, 185],
      [162, 205],
      [157, 228],
    ],
    [
      [159, 240],
      [156, 252],
      [150, 254],
    ],
    [
      [145, 254],
      [143, 244],
      [144, 232],
    ],
    [
      [145, 210],
      [143, 190],
      [142, 172],
    ],
    [
      [141, 155],
      [139, 140],
      [138, 128],
    ],
    [
      [137, 126],
      [136, 125],
      [135, 124],
    ],
    [
      [135, 150],
      [133, 175],
      [133, 198],
    ],
    [
      [136, 212],
      [140, 226],
      [140, 240],
    ],
    [
      [142, 270],
      [138, 300],
      [132, 322],
    ],
    [
      [136, 345],
      [134, 375],
      [126, 400],
    ],
    [
      [128, 410],
      [130, 418],
      [124, 422],
    ],
    [
      [113, 422],
      [110, 422],
      [108, 422],
    ],
    [
      [106, 416],
      [108, 408],
      [110, 400],
    ],
    [
      [108, 375],
      [106, 350],
      [110, 325],
    ],
    [
      [106, 300],
      [104, 275],
      [102, 250],
    ],
    [
      [101, 249],
      [100.5, 248],
      [100, 248],
    ],
  ],
};

/** Весь силуэт одним контуром: правая половина вниз, левая обратно вверх. */
export function outlinePath(s: BodyShape): string {
  const right = [OUTLINE.start, ...OUTLINE.segs.flatMap((seg) => seg)].map((p) => place(p, s));
  let d = `M${pt(right[0]!)}`;
  for (let i = 1; i < right.length; i += 3) {
    d += `C${pt(right[i]!)} ${pt(right[i + 1]!)} ${pt(right[i + 2]!)}`;
  }
  // Левая половина: те же отрезки в обратном порядке, зеркально.
  const left = right.map(mirror);
  for (let i = left.length - 1; i > 0; i -= 3) {
    d += `C${pt(left[i - 1]!)} ${pt(left[i - 2]!)} ${pt(left[i - 3]!)}`;
  }
  return `${d}Z`;
}

export function headOf(s: BodyShape) {
  const [, cy] = place([CX, 36], s);
  const k = s.height * s.growth;
  return { cx: CX, cy, rx: 18.5 * s.growth * (0.9 + 0.1 * s.neck), ry: 22.5 * k };
}

/** Макушка — для отметки роста. */
export const crownY = (s: BodyShape) => GROUND - (GROUND - 13) * s.height * s.growth;

/* Мышцы ------------------------------------------------------------------ */

export interface MuscleShape {
  group: MuscleGroup;
  shape: HalfShape;
}

const DELTOID: HalfShape = {
  start: [139, 82],
  segs: [
    [
      [152, 83],
      [161, 96],
      [159, 114],
    ],
    [
      [151, 113],
      [144, 106],
      [139, 98],
    ],
    [
      [137, 93],
      [137, 87],
      [139, 82],
    ],
  ],
};

const FOREARM: HalfShape = {
  start: [145, 172],
  segs: [
    [
      [154, 170],
      [161, 182],
      [159, 199],
    ],
    [
      [157, 212],
      [152, 222],
      [148, 224],
    ],
    [
      [145, 210],
      [144, 190],
      [145, 172],
    ],
  ],
};

export const FRONT: MuscleShape[] = [
  {
    group: 'traps',
    shape: {
      start: [112, 70],
      segs: [
        [
          [120, 74],
          [130, 77],
          [140, 80],
        ],
        [
          [132, 84],
          [122, 84],
          [114, 80],
        ],
        [
          [112, 77],
          [112, 74],
          [112, 70],
        ],
      ],
    },
  },
  { group: 'shoulders', shape: DELTOID },
  {
    group: 'chest',
    shape: {
      start: [102, 88],
      segs: [
        [
          [114, 85],
          [130, 86],
          [137, 92],
        ],
        [
          [140, 102],
          [137, 116],
          [129, 123],
        ],
        [
          [120, 127],
          [108, 126],
          [102, 124],
        ],
        [
          [101, 112],
          [101, 100],
          [102, 88],
        ],
      ],
    },
  },
  {
    group: 'biceps',
    shape: {
      start: [140, 124],
      segs: [
        [
          [149, 119],
          [158, 127],
          [158, 142],
        ],
        [
          [157, 155],
          [151, 163],
          [144, 163],
        ],
        [
          [141, 151],
          [139, 137],
          [140, 124],
        ],
      ],
    },
  },
  { group: 'forearms', shape: FOREARM },
  {
    group: 'abs',
    shape: {
      start: [102, 130],
      segs: [
        [
          [110, 129],
          [118, 129],
          [124, 131],
        ],
        [
          [126, 152],
          [126, 180],
          [121, 206],
        ],
        [
          [114, 208],
          [108, 209],
          [102, 210],
        ],
        [
          [101, 184],
          [101, 156],
          [102, 130],
        ],
      ],
    },
  },
  {
    group: 'quads',
    shape: {
      start: [106, 252],
      segs: [
        [
          [118, 244],
          [136, 238],
          [139, 250],
        ],
        [
          [141, 275],
          [136, 300],
          [128, 316],
        ],
        [
          [118, 320],
          [110, 312],
          [108, 296],
        ],
        [
          [106, 280],
          [104, 264],
          [106, 252],
        ],
      ],
    },
  },
  {
    group: 'calves',
    shape: {
      start: [115, 334],
      segs: [
        [
          [123, 330],
          [132, 338],
          [132, 352],
        ],
        [
          [131, 370],
          [126, 385],
          [120, 390],
        ],
        [
          [114, 378],
          [111, 356],
          [115, 334],
        ],
      ],
    },
  },
];

export const BACK: MuscleShape[] = [
  {
    group: 'traps',
    shape: {
      start: [100, 62],
      segs: [
        [
          [104, 63],
          [108, 64],
          [111, 66],
        ],
        [
          [122, 74],
          [134, 78],
          [142, 82],
        ],
        [
          [130, 90],
          [114, 108],
          [100, 142],
        ],
        [
          [100, 120],
          [100, 80],
          [100, 62],
        ],
      ],
    },
  },
  { group: 'shoulders', shape: DELTOID },
  {
    group: 'back',
    shape: {
      start: [110, 106],
      segs: [
        [
          [124, 98],
          [135, 110],
          [135, 128],
        ],
        [
          [133, 160],
          [124, 184],
          [105, 196],
        ],
        [
          [106, 170],
          [108, 140],
          [110, 106],
        ],
      ],
    },
  },
  {
    group: 'back',
    shape: {
      start: [101, 152],
      segs: [
        [
          [104, 152],
          [107, 153],
          [108, 154],
        ],
        [
          [110, 175],
          [110, 195],
          [107, 212],
        ],
        [
          [105, 212],
          [103, 212],
          [101, 212],
        ],
        [
          [101, 190],
          [101, 170],
          [101, 152],
        ],
      ],
    },
  },
  {
    group: 'triceps',
    shape: {
      start: [139, 122],
      segs: [
        [
          [148, 117],
          [158, 125],
          [159, 141],
        ],
        [
          [158, 156],
          [150, 164],
          [143, 163],
        ],
        [
          [140, 149],
          [138, 135],
          [139, 122],
        ],
      ],
    },
  },
  { group: 'forearms', shape: FOREARM },
  {
    group: 'glutes',
    shape: {
      start: [101, 214],
      segs: [
        [
          [116, 206],
          [136, 212],
          [139, 232],
        ],
        [
          [140, 250],
          [126, 258],
          [112, 256],
        ],
        [
          [104, 254],
          [101, 246],
          [101, 236],
        ],
        [
          [101, 229],
          [101, 221],
          [101, 214],
        ],
      ],
    },
  },
  {
    group: 'hamstrings',
    shape: {
      start: [106, 262],
      segs: [
        [
          [118, 256],
          [134, 256],
          [138, 266],
        ],
        [
          [138, 288],
          [132, 308],
          [126, 316],
        ],
        [
          [118, 318],
          [110, 312],
          [108, 298],
        ],
        [
          [105, 286],
          [104, 272],
          [106, 262],
        ],
      ],
    },
  },
  {
    group: 'calves',
    shape: {
      start: [112, 332],
      segs: [
        [
          [122, 324],
          [134, 334],
          [133, 352],
        ],
        [
          [132, 370],
          [126, 382],
          [120, 384],
        ],
        [
          [114, 376],
          [110, 356],
          [112, 332],
        ],
      ],
    },
  },
];

/** Линии пресса: три «кубика» по высоте. */
export function absLines(s: BodyShape): Array<[Pt, Pt]> {
  return [150, 170, 190].map((y) => {
    const b = place([123, y], s);
    return [mirror(b), b] as [Pt, Pt];
  });
}

/* Травмы ----------------------------------------------------------------- */

const ZONE_AT: Record<BodyZone, { at: Pt; view: 'front' | 'back' }> = {
  neck: { at: [100, 66], view: 'front' },
  shoulder: { at: [150, 92], view: 'front' },
  elbow: { at: [151, 168], view: 'front' },
  wrist: { at: [152, 226], view: 'front' },
  chest: { at: [116, 104], view: 'front' },
  lowerBack: { at: [100, 190], view: 'back' },
  hip: { at: [136, 232], view: 'front' },
  knee: { at: [121, 322], view: 'front' },
  ankle: { at: [118, 402], view: 'front' },
};

export function injuryPoint(zone: BodyZone, s: BodyShape) {
  const z = ZONE_AT[zone];
  return { view: z.view, at: place(z.at, s) };
}

/* Цвет мышц -------------------------------------------------------------- */

const STOPS = ['--m-low', '--m-mid', '--m-high', '--m-top'] as const;

/** Уровень 0…1 → цвет от бледного к насыщенному; нет данных — серый. */
export function heat(level: number | null): string {
  if (level === null) return 'var(--m-none)';
  const p = clamp(level, 0, 1) * 3;
  const i = Math.min(2, Math.floor(p));
  const t = Math.round((p - i) * 100);
  return `color-mix(in srgb, var(${STOPS[i]}) ${100 - t}%, var(${STOPS[i + 1]}))`;
}

export function levelWord(level: number | null): string {
  if (level === null) return 'нет данных';
  if (level < 0.15) return 'слабо';
  if (level < 0.4) return 'начальный';
  if (level < 0.6) return 'средний';
  if (level < 0.8) return 'хороший';
  return 'сильный';
}
