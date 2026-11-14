import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MUSCLE_GROUPS, type MuscleGroup, type PortraitResponse } from '@trektren/shared';
import { api } from '../api/http';
import { MUSCLE_LABELS } from '../card/labels';
import { formatDate, num, plural } from '../format';
import {
  absLines,
  BACK,
  crownY,
  FRONT,
  GROUND,
  headOf,
  heat,
  injuryPoint,
  levelWord,
  musclePaths,
  outlinePath,
  SHAPE_KEYS,
  shapeOf,
  type BodyShape,
  type MuscleShape,
} from './figure';

export const PORTRAIT_KEY = ['portrait'] as const;

export const usePortrait = () =>
  useQuery({ queryKey: PORTRAIT_KEY, queryFn: () => api<PortraitResponse>('/portrait') });

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Плавный переход формы тела: когда меняется вес, жир или силовые, фигура
 * перетекает в новую, а не прыгает. При первом показе человечек «вырастает».
 */
function useTweenShape(target: BodyShape): BodyShape {
  const [shape, setShape] = useState<BodyShape>(() =>
    reducedMotion() ? target : { ...target, growth: Math.max(0.5, target.growth - 0.25) },
  );
  const current = useRef(shape);
  const key = SHAPE_KEYS.map((k) => target[k].toFixed(3)).join('|');

  useEffect(() => {
    if (reducedMotion()) {
      current.current = target;
      setShape(target);
      return;
    }
    const from = current.current;
    const started = performance.now();
    const ms = 900;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - started) / ms);
      const e = 1 - (1 - k) ** 3;
      const next = { ...from };
      for (const name of SHAPE_KEYS) next[name] = from[name] + (target[name] - from[name]) * e;
      current.current = next;
      setShape(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- форма сравнивается по значениям
  }, [key]);

  return shape;
}

interface FigureProps {
  view: 'front' | 'back';
  shape: BodyShape;
  ghost: BodyShape | null;
  data: PortraitResponse;
  empty: boolean;
}

function Figure({ view, shape, ghost, data, empty }: FigureProps) {
  const muscles: MuscleShape[] = view === 'front' ? FRONT : BACK;
  const head = headOf(shape);
  const weak = new Set(data.weak);
  const priority = new Set(data.priority);
  const injuries = data.injuries
    .map((i) => ({ ...i, ...injuryPoint(i.zone, shape) }))
    .filter((i) => i.view === view);
  const top = crownY(shape);

  return (
    <svg
      className="body-figure"
      viewBox="-12 -50 224 482"
      data-empty={empty || undefined}
      aria-hidden="true"
    >
      <line className="ground" x1="20" x2="180" y1={GROUND + 1} y2={GROUND + 1} />
      {view === 'front' && (
        <g className="height-mark">
          <line x1="-6" x2="194" y1={top} y2={top} />
          <text x="-6" y={top - 6}>
            {data.body.heightCm} см
          </text>
        </g>
      )}
      <path className="silhouette" d={outlinePath(shape)} />
      <ellipse className="silhouette" {...head} />
      {!empty &&
        muscles.map((m, i) =>
          musclePaths(m.shape, shape).map((d, side) => (
            <path
              key={`${i}-${side}`}
              className="muscle"
              d={d}
              style={{ fill: heat(data.body.levels[m.group]) }}
              data-weak={weak.has(m.group) || undefined}
              data-priority={(priority.has(m.group) && !weak.has(m.group)) || undefined}
            >
              <title>{`${MUSCLE_LABELS[m.group]}: ${levelWord(data.body.levels[m.group])}`}</title>
            </path>
          )),
        )}
      {!empty &&
        view === 'front' &&
        absLines(shape).map(([a, b], i) => (
          <line key={i} className="abs-line" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
        ))}
      {ghost && <path className="ghost" d={outlinePath(ghost)} />}
      {injuries.map((i) => (
        <g key={`${i.zone}-${i.area}`}>
          <circle className="injury-ring" cx={i.at[0]} cy={i.at[1]} r="7" />
          <circle className="injury" cx={i.at[0]} cy={i.at[1]} r="5">
            <title>{`Травма: ${i.area}`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}

const WEIGHT_SOURCE: Record<PortraitResponse['weightSource'], string> = {
  average: 'средняя за 7 дней',
  log: 'последнее взвешивание',
  card: 'из профиля',
  default: 'не указан',
};

/**
 * Портрет: человечек, который растёт по мере заполнения профиля, а потом
 * становится тобой — рост, вес, жир и мышцы по силовым. Меняется с каждым
 * взвешиванием и тренировкой. Пунктир — каким был в начале пути.
 */
export function Portrait({ compact = false }: { compact?: boolean }) {
  const query = usePortrait();
  const [compare, setCompare] = useState(false);
  const data = query.data;

  const growth = data ? 0.6 + (0.4 * data.completeness.filled) / data.completeness.total : 0.6;
  const target = data ? shapeOf(data.body, growth) : null;
  const shape = useTweenShape(
    target ?? {
      neck: 1,
      shoulders: 1,
      chest: 1,
      waist: 1,
      hips: 1,
      arms: 1,
      legs: 1,
      height: 1,
      growth: 0.6,
    },
  );

  if (query.isPending) {
    return (
      <section className="portrait-card" aria-label="Портрет">
        <p className="state">Рисую портрет…</p>
      </section>
    );
  }
  if (query.isError || !data) {
    return (
      <section className="portrait-card" aria-label="Портрет">
        <p className="form-error">Портрет не загрузился.</p>
        <button type="button" className="link-button" onClick={() => void query.refetch()}>
          Повторить
        </button>
      </section>
    );
  }

  const { completeness: c, body, start } = data;
  const complete = c.filled >= c.total;
  const empty = c.filled === 0;
  // Сравнивать есть с чем, когда с начала пути прошла хотя бы неделя.
  const since = start ? Math.round((Date.now() - new Date(start.date).getTime()) / 86400000) : 0;
  const showStart = start !== null && since >= 7;
  const ghost = compare && showStart ? shapeOf(start.body, 1) : null;
  const known = MUSCLE_GROUPS.filter((m) => body.levels[m] !== null);
  const weightDelta = start ? Math.round((body.weightKg - start.body.weightKg) * 10) / 10 : 0;

  const summary = [
    `${body.sex === 'female' ? 'Женщина' : 'Мужчина'}, ${body.heightCm} см, ${num(body.weightKg)} кг`,
    `жир около ${body.bodyFatPct}%`,
    data.strengthLabel ? `сила: ${data.strengthLabel}` : 'силовые не заполнены',
    known.length
      ? `мышцы: ${known.map((m) => `${MUSCLE_LABELS[m].toLowerCase()} — ${levelWord(body.levels[m])}`).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('; ');

  return (
    <section className="portrait-card" aria-labelledby="portrait-heading">
      <div className="card-head">
        <h2 id="portrait-heading" className="group-title">
          {complete ? 'Твой портрет' : 'Человечек растёт'}
        </h2>
        {data.strengthLabel && <span className="badge badge-primary">{data.strengthLabel}</span>}
      </div>

      <div className="portrait-stage" role="img" aria-label={summary}>
        <figure>
          <Figure view="front" shape={shape} ghost={ghost} data={data} empty={empty} />
          <figcaption>спереди</figcaption>
        </figure>
        <figure>
          <Figure view="back" shape={shape} ghost={ghost} data={data} empty={empty} />
          <figcaption>сзади</figcaption>
        </figure>
      </div>

      {!complete && (
        <div className="portrait-growth">
          <span className="bar bar-green" aria-hidden="true">
            <span
              style={{ width: `${(c.filled / c.total) * 100}%` }}
              data-zero={empty || undefined}
            />
          </span>
          <p>
            Профиль заполнен на {c.filled} из {c.total}. Каждый раздел добавляет человечку роста, а
            силовые — мышц. Заполнишь всё — станет твоим портретом.
          </p>
        </div>
      )}

      <div className="portrait-stats">
        <span className="stat">
          <span className="stat-value">{body.heightCm}</span>
          <span className="stat-label">рост, см</span>
        </span>
        <span className="stat">
          <span className="stat-value">{num(body.weightKg)}</span>
          <span className="stat-label">вес, {WEIGHT_SOURCE[data.weightSource]}</span>
        </span>
        <span className="stat">
          <span className="stat-value">{num(data.bmi)}</span>
          <span className="stat-label">ИМТ</span>
        </span>
        <span className="stat">
          <span className="stat-value">
            {body.bodyFatEstimated ? '≈' : ''}
            {body.bodyFatPct}%
          </span>
          <span className="stat-label">
            жир{body.bodyFatEstimated ? ', оценка по ИМТ и возрасту' : ''}
          </span>
        </span>
      </div>

      {!compact && (
        <div className="portrait-legend">
          <span>
            слабее
            <i className="heat-scale" aria-hidden="true" />
            сильнее
          </span>
          {data.weak.length > 0 && (
            <span>
              <i className="legend-swatch legend-weak" aria-hidden="true" />
              слабое место
            </span>
          )}
          {data.priority.length > 0 && (
            <span>
              <i className="legend-swatch legend-priority" aria-hidden="true" />
              приоритет
            </span>
          )}
          {data.injuries.length > 0 && (
            <span>
              <i className="legend-swatch legend-injury" aria-hidden="true" />
              травма
            </span>
          )}
        </div>
      )}

      {known.length === 0 && !empty && (
        <p className="plan-hint">
          Мышцы пока серые: впиши максимумы в «Силовых» — цвет покажет, что сильнее, что отстаёт.
        </p>
      )}

      {showStart && start && (
        <div className="portrait-compare">
          <button
            type="button"
            className="chip"
            aria-pressed={compare}
            onClick={() => setCompare((v) => !v)}
          >
            Сравнить с началом
          </button>
          <span className="card-sub">
            {formatDate(start.date).replace(' г.', '')}: {num(start.body.weightKg)} кг
            {weightDelta !== 0 &&
              `, сейчас ${weightDelta > 0 ? '+' : '−'}${num(Math.abs(weightDelta))} кг`}
          </span>
        </div>
      )}

      {!compact && known.length > 0 && <MuscleList levels={body.levels} weak={data.weak} />}
    </section>
  );
}

function MuscleList({
  levels,
  weak,
}: {
  levels: Record<MuscleGroup, number | null>;
  weak: MuscleGroup[];
}) {
  const rows = MUSCLE_GROUPS.filter((m) => levels[m] !== null).sort(
    (a, b) => (levels[b] ?? 0) - (levels[a] ?? 0),
  );
  return (
    <details className="muscle-list">
      <summary>
        Мышцы по уровню: {rows.length} {plural(rows.length, ['группа', 'группы', 'групп'])}
      </summary>
      <ul>
        {rows.map((m) => (
          <li key={m} data-weak={weak.includes(m) || undefined}>
            <span>{MUSCLE_LABELS[m]}</span>
            <span className="bar bar-thin" aria-hidden="true">
              <span
                style={{ width: `${(levels[m] ?? 0) * 100}%`, background: heat(levels[m]) }}
                data-zero={(levels[m] ?? 0) === 0 || undefined}
              />
            </span>
            <span className="muscle-level">{levelWord(levels[m])}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
