import type { AthleteCard, BalanceFinding, DiagnosticTest } from '@trektren/shared';
import type { Exercise } from '../exercises/repo.js';

/**
 * Соотношения максимумов у тех, кто тренируется сбалансированно.
 * Ниже нормы — первое движение отстаёт от второго.
 */
interface Rule {
  id: string;
  lagging: string;
  against: string;
  norm: [number, number];
  femaleNorm?: [number, number];
  /** Обратная проверка: выше нормы — отстаёт уже «against». */
  reverse?: { id: string; above: number };
}

const RULES: Rule[] = [
  {
    id: 'squat-vs-deadlift',
    lagging: 'barbell-back-squat',
    against: 'deadlift',
    norm: [0.8, 0.9],
    reverse: { id: 'deadlift-vs-squat', above: 0.97 },
  },
  {
    id: 'bench-vs-squat',
    lagging: 'bench-press',
    against: 'barbell-back-squat',
    norm: [0.65, 0.85],
    femaleNorm: [0.5, 0.7],
  },
  { id: 'ohp-vs-bench', lagging: 'overhead-press', against: 'bench-press', norm: [0.6, 0.72] },
  { id: 'row-vs-bench', lagging: 'barbell-row', against: 'bench-press', norm: [0.7, 0.95] },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toFixed(2).replace('.', ',');

/**
 * Ищет отстающие движения по соотношениям. Берём только свои цифры человека:
 * сравнивать посчитанное с посчитанным бессмысленно.
 */
export function analyzeBalance(
  card: AthleteCard,
  exercises: Map<string, Exercise>,
): BalanceFinding[] {
  const lifts = card.strength?.lifts ?? {};
  const female = card.basics?.sex === 'female';
  const name = (slug: string) => exercises.get(slug)?.name ?? slug;
  const findings: BalanceFinding[] = [];

  for (const rule of RULES) {
    const a = lifts[rule.lagging]?.oneRmKg;
    const b = lifts[rule.against]?.oneRmKg;
    if (!a || !b) continue;
    const ratio = round2(a / b);
    const norm = female && rule.femaleNorm ? rule.femaleNorm : rule.norm;
    if (ratio < norm[0]) {
      findings.push({
        id: rule.id,
        lagging: rule.lagging,
        laggingName: name(rule.lagging),
        against: rule.against,
        againstName: name(rule.against),
        ratio,
        norm,
        text: `${name(rule.lagging)} ${a} кг — это ${fmt(ratio)} от движения «${name(rule.against).toLowerCase()}» (${b} кг) при норме ${fmt(norm[0])}–${fmt(norm[1])}. ${name(rule.lagging)} отстаёт.`,
      });
    } else if (rule.reverse && ratio > rule.reverse.above) {
      findings.push({
        id: rule.reverse.id,
        lagging: rule.against,
        laggingName: name(rule.against),
        against: rule.lagging,
        againstName: name(rule.lagging),
        ratio: round2(b / a),
        norm: [round2(1 / norm[1]), round2(1 / norm[0])],
        text: `${name(rule.against)} ${b} кг почти равна движению «${name(rule.lagging).toLowerCase()}» (${a} кг): обычно она на 10–25% больше. ${name(rule.against)} отстаёт.`,
      });
    }
  }
  return findings;
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

export interface Conclusion {
  problem: boolean;
  text: string;
}

const bad = (text: string): Conclusion => ({ problem: true, text });
const ok = (text: string): Conclusion => ({ problem: false, text });

export interface Protocol {
  tests: (maxes: Record<string, number>) => DiagnosticTest[];
  /** Выводы по результатам: что проседает (problem) и что с этим делать. */
  conclude: (r: Record<string, number>, maxes: Record<string, number>) => Conclusion[];
  /** Если тесты ничего не выявили. */
  fallback: string;
}

const epley = (w: number, reps: number) => (reps <= 1 ? w : w * (1 + reps / 30));

/** Тесты для каждого отставания: какие проверить, как сделать и как понять результат. */
export const PROTOCOLS: Record<string, Protocol> = {
  'squat-vs-deadlift': {
    tests: (m) => [
      {
        id: 'front-squat',
        title: 'Фронтальный присед',
        howTo: 'Лучший вес на 3 чистых повтора в полную глубину. Впиши вес.',
        unit: 'kg',
      },
      {
        id: 'pause-squat',
        title: 'Присед с паузой 2 секунды внизу',
        howTo: `${roundTo((m['barbell-back-squat'] ?? 100) * 0.7, 2.5)} кг: сколько повторов сделаешь с запасом 1. Пауза — полная остановка в низу.`,
        unit: 'reps',
      },
      {
        id: 'ankle',
        title: 'Голеностоп: колено к стене',
        howTo:
          'Стопа перед стеной, пятка на полу. Отодвигай стопу, пока колено ещё касается стены. Впиши расстояние от большого пальца до стены.',
        unit: 'cm',
      },
    ],
    conclude: (r, m) => {
      const out: Conclusion[] = [];
      const back = m['barbell-back-squat'];
      if (r['front-squat'] && back) {
        const ratio = epley(r['front-squat'], 3) / back;
        if (ratio < 0.78) {
          out.push(
            bad(
              `Фронтальный ≈ ${Math.round(ratio * 100)}% от приседа (норма 80–85%): отстают квадрицепсы и удержание корпуса. В приседе таз уходит назад и работает спина — отсюда сильная становая и слабый присед. Нужны фронтальный присед, присед с паузой, разгибания ног.`,
            ),
          );
        } else {
          out.push(
            ok(
              `Фронтальный ≈ ${Math.round(ratio * 100)}% от приседа — квадрицепсы в порядке, дело не в них.`,
            ),
          );
        }
      }
      if (r['pause-squat'] !== undefined) {
        out.push(
          r['pause-squat'] < 4
            ? bad(
                `С паузой только ${r['pause-squat']} повт. — проседаешь в нижней точке: теряешь натяжение и не выходишь из «ямы». Нужен присед с паузой и на ящик.`,
              )
            : ok(`С паузой ${r['pause-squat']} повт. — низ сильный.`),
        );
      }
      if (r.ankle !== undefined) {
        out.push(
          r.ankle < 9
            ? bad(
                `Голеностоп ${r.ankle} см (норма 10+): не хватает подвижности, корпус заваливается вперёд, глубина съедается. Мобилизация голеностопа каждый день, присед в штангетках или с подкладкой под пятки.`,
              )
            : ok(`Голеностоп ${r.ankle} см — подвижности хватает.`),
        );
      }
      return out;
    },
    fallback:
      'Тесты в норме — значит присед просто недотренирован: его делали реже и легче, чем становую. Нужна частота 2 раза в неделю: тяжёлый день и лёгкий с паузами.',
  },
  'deadlift-vs-squat': {
    tests: (m) => [
      {
        id: 'rdl',
        title: 'Румынская тяга',
        howTo: `Лучший вес на 5 повторов без округления спины. Ориентир — ${roundTo((m.deadlift ?? 100) * 0.55, 2.5)} кг и выше.`,
        unit: 'kg',
      },
      {
        id: 'hang',
        title: 'Вис на перекладине',
        howTo: 'Сколько секунд висишь двумя руками без лямок.',
        unit: 'sec',
      },
    ],
    conclude: (r, m) => {
      const out: Conclusion[] = [];
      const dl = m.deadlift;
      if (r.rdl && dl) {
        const ratio = epley(r.rdl, 5) / dl;
        out.push(
          ratio < 0.65
            ? bad(
                `Румынская ≈ ${Math.round(ratio * 100)}% от становой (норма 65–75%): слабые бицепс бедра и разгибатели спины. Румынская и гиперэкстензия с весом 2 раза в неделю.`,
              )
            : ok(`Румынская ≈ ${Math.round(ratio * 100)}% — задняя цепь в порядке.`),
        );
      }
      if (r.hang !== undefined) {
        out.push(
          r.hang < 45
            ? bad(
                `Вис ${r.hang} сек — хват не держит тяжёлую становую. Висы с весом и удержание штанги в конце тренировки.`,
              )
            : ok(`Вис ${r.hang} сек — хват не мешает.`),
        );
      }
      return out;
    },
    fallback:
      'Тесты в норме — становая недотренирована технически: нужна отдельная тяжёлая тяга раз в неделю и тяга с плинтов для скорости с пола.',
  },
  'bench-vs-squat': {
    tests: (m) => [
      {
        id: 'close-grip',
        title: 'Жим узким хватом',
        howTo: `Лучший вес на 3 повтора, хват на ширине плеч. Ориентир — около ${roundTo((m['bench-press'] ?? 80) * 0.8, 2.5)} кг.`,
        unit: 'kg',
      },
      {
        id: 'pause-bench',
        title: 'Жим с паузой на груди',
        howTo: 'Лучший вес на 3 повтора с остановкой на груди 1 секунду.',
        unit: 'kg',
      },
    ],
    conclude: (r, m) => {
      const out: Conclusion[] = [];
      const bench = m['bench-press'];
      if (r['close-grip'] && bench) {
        const ratio = epley(r['close-grip'], 3) / bench;
        out.push(
          ratio < 0.85
            ? bad(
                `Узкий ≈ ${Math.round(ratio * 100)}% от жима (норма 85–90%): отстаёт трицепс — жим встаёт в верхней половине. Узкий жим и французский жим 2 раза в неделю.`,
              )
            : ok(`Узкий ≈ ${Math.round(ratio * 100)}% — трицепс в порядке.`),
        );
      }
      if (r['pause-bench'] && bench) {
        const ratio = epley(r['pause-bench'], 3) / bench;
        out.push(
          ratio < 0.9
            ? bad(
                `С паузой ≈ ${Math.round(ratio * 100)}% (норма 90–95%): слабый старт с груди. Жим с паузой и с бруском.`,
              )
            : ok(`С паузой ≈ ${Math.round(ratio * 100)}% — с груди жмёшь уверенно.`),
        );
      }
      return out;
    },
    fallback:
      'Тесты в норме — жиму не хватает частоты и объёма: 2–3 жимовых дня в неделю с разной интенсивностью.',
  },
  'ohp-vs-bench': {
    tests: () => [
      {
        id: 'seated-db',
        title: 'Жим гантелей сидя',
        howTo: 'Вес одной гантели на 8 повторов с запасом 1.',
        unit: 'kg',
      },
      {
        id: 'lateral',
        title: 'Махи гантелями в стороны',
        howTo: 'Вес одной гантели на 12 чистых повторов без раскачки.',
        unit: 'kg',
      },
    ],
    conclude: (r, m) => {
      const out: Conclusion[] = [];
      const ohp = m['overhead-press'];
      if (r['seated-db'] && ohp) {
        const ratio = (epley(r['seated-db'], 9) * 2) / ohp;
        out.push(
          ratio < 0.75
            ? bad(
                `Две гантели сидя ≈ ${Math.round(ratio * 100)}% от жима стоя: слабые дельты — работа на них отдельно, 12–16 подходов в неделю.`,
              )
            : ok(
                `Гантели сидя в норме: жим стоя упирается в технику и корпус — жим стоя 2 раза в неделю, пресс и ягодицы держат корпус.`,
              ),
        );
      }
      if (r.lateral && ohp) {
        out.push(
          r.lateral < ohp * 0.12
            ? bad(`Махи ${r.lateral} кг — средняя дельта слабая для твоего жима, её надо добить.`)
            : ok(`Махи ${r.lateral} кг — средняя дельта в порядке.`),
        );
      }
      return out;
    },
    fallback: 'Тесты в норме — жиму стоя не хватает частоты: ставим его 2 раза в неделю.',
  },
  'row-vs-bench': {
    tests: () => [
      {
        id: 'pullups',
        title: 'Подтягивания',
        howTo: 'Максимум повторов широким хватом, подбородок над перекладиной, без раскачки.',
        unit: 'reps',
      },
    ],
    conclude: (r) =>
      r.pullups !== undefined
        ? [
            r.pullups < 8
              ? bad(
                  `${r.pullups} подтягиваний — спина слабая для твоего жима. Это и про плечи: без сильной спины жим не растёт и травмируется плечо. Тяги 2 раза в неделю, подтягивания с резиной до 10 чистых.`,
                )
              : ok(
                  `${r.pullups} подтягиваний — спина сильная, тяга в наклоне упирается в технику.`,
                ),
          ]
        : [],
    fallback: 'Спине нужен объём: подходов на тяги не меньше, чем на жимы.',
  },
};
