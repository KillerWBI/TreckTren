import type { WeightPoint } from '@trektren/shared';

const W = 360;
const H = 96;
const PAD = 6;

/**
 * 4 недели веса: точки — утренние взвешивания, линия — средняя за 7 дней.
 * Без осей: подписаны только края шкалы, остальное — в тексте тренда.
 */
export function WeightChart({ points }: { points: WeightPoint[] }) {
  const values = points.flatMap((p) => [p.morning, p.avg7].filter((v): v is number => v !== null));
  if (values.filter(Boolean).length < 2) return null;
  const min = Math.min(...values) - 0.3;
  const max = Math.max(...values) + 0.3;
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (points.length - 1);
  const y = (v: number) => H - PAD - ((v - min) * (H - PAD * 2)) / (max - min);
  const line = points
    .map((p, i) => (p.avg7 === null ? null : `${x(i).toFixed(1)},${y(p.avg7).toFixed(1)}`))
    .filter(Boolean);
  const label = `Вес за 4 недели: от ${min.toFixed(1)} до ${max.toFixed(1)} кг`;

  return (
    <figure className="weight-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {line.length > 1 && <polyline className="weight-avg" points={line.join(' ')} />}
        {points.map((p, i) =>
          p.morning === null ? null : (
            <circle key={p.date} className="weight-dot" cx={x(i)} cy={y(p.morning)} r={2.6} />
          ),
        )}
      </svg>
      <figcaption className="weight-legend">
        <span>
          <i className="legend-dot" /> утро
        </span>
        <span>
          <i className="legend-line" /> средняя за 7 дней
        </span>
        <span className="weight-range">
          {max.toFixed(1).replace('.', ',')} / {min.toFixed(1).replace('.', ',')} кг
        </span>
      </figcaption>
    </figure>
  );
}
