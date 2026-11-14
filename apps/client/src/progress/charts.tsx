import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ProgressDay, StrengthSeries } from '@trektren/shared';
import { num } from '../format';

/**
 * Графики «Прогресса». Одна мера — один график, без второй оси.
 * Линии 2 px, столбцы не толще 24 px со скруглённым верхом, сетка — волосок.
 */

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const shortFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return shortFmt.format(new Date(y!, m! - 1, d!)).replace('.', '');
};

const AXIS = {
  stroke: 'var(--line)',
  tick: { fill: 'var(--ink-3)', fontSize: 12, fontWeight: 700 },
  tickLine: false,
} as const;

function TooltipBox({
  date,
  rows,
}: {
  date: string;
  rows: Array<{ label: string; value: string; color?: string }>;
}) {
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-date">{shortDate(date)}</p>
      {rows.map((r) => (
        <p key={r.label}>
          {r.color && <i style={{ background: r.color }} aria-hidden="true" />}
          {r.label}: <strong>{r.value}</strong>
        </p>
      ))}
    </div>
  );
}

function Frame({ height = 220, children }: { height?: number; children: ReactNode }) {
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as never}
      </ResponsiveContainer>
    </div>
  );
}

/** Вес: точки — утренние взвешивания, линия — средняя за 7 дней. */
export function WeightTrendChart({ days }: { days: ProgressDay[] }) {
  const has = days.filter((d) => d.morning !== null).length;
  if (has < 2)
    return <p className="chart-empty">Взвесься утром хотя бы 2 раза — появится график.</p>;
  return (
    <>
      <Frame>
        <ComposedChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28} {...AXIS} />
          <YAxis
            domain={['dataMin - 0.5', 'dataMax + 0.5']}
            tickFormatter={(v: number) => num(Math.round(v * 10) / 10)}
            width={44}
            axisLine={false}
            {...AXIS}
          />
          <Tooltip
            cursor={{ stroke: 'var(--line-2)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              const d = active ? (payload?.[0]?.payload as ProgressDay | undefined) : undefined;
              if (!d) return null;
              return (
                <TooltipBox
                  date={d.date}
                  rows={[
                    ...(d.morning !== null
                      ? [{ label: 'Утро', value: `${num(d.morning)} кг`, color: 'var(--ink-3)' }]
                      : []),
                    ...(d.evening !== null
                      ? [{ label: 'Вечер', value: `${num(d.evening)} кг` }]
                      : []),
                    ...(d.avg7 !== null
                      ? [{ label: 'Средняя', value: `${num(d.avg7)} кг`, color: 'var(--primary)' }]
                      : []),
                  ]}
                />
              );
            }}
          />
          <Line
            dataKey="morning"
            stroke="none"
            isAnimationActive={!reduced()}
            dot={{ r: 4, fill: 'var(--ink-3)', stroke: 'var(--surface)', strokeWidth: 2 }}
            activeDot={{ r: 6, fill: 'var(--ink-2)', stroke: 'var(--surface)', strokeWidth: 2 }}
          />
          <Line
            dataKey="avg7"
            type="monotone"
            stroke="var(--primary)"
            strokeWidth={2.5}
            dot={false}
            connectNulls
            isAnimationActive={!reduced()}
            animationDuration={900}
          />
        </ComposedChart>
      </Frame>
      <p className="weight-legend">
        <span>
          <i className="legend-dot" /> утро
        </span>
        <span>
          <i className="legend-line" /> средняя за 7 дней
        </span>
      </p>
    </>
  );
}

interface BarsProps {
  days: ProgressDay[];
  field: 'steps' | 'kcal' | 'sleepHours';
  color: string;
  unit: string;
  /** Линия-ориентир: норма калорий, 7 часов сна. */
  reference?: { value: number; label: string } | undefined;
  empty: string;
}

/** Круглые деления оси: 4 шага по 1, 2, 2,5 или 5 × 10ⁿ. */
function niceTicks(max: number): number[] {
  const rough = Math.max(max, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const n = rough / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** Столбцы по дням: шаги, калории, сон. */
export function DayBars({ days, field, color, unit, reference, empty }: BarsProps) {
  const filled = days.filter((d) => d[field] !== null).length;
  if (filled === 0) return <p className="chart-empty">{empty}</p>;
  // Неразрывный пробел: подпись оси не должна переноситься.
  const compact = (v: number) =>
    v >= 10000 ? `${num(Math.round(v / 1000))}\u00a0тыс` : num(Math.round(v * 10) / 10);
  const ticks = niceTicks(Math.max(...days.map((d) => d[field] ?? 0), reference?.value ?? 0));
  return (
    <Frame height={180}>
      <BarChart
        data={days}
        margin={{ top: 8, right: reference ? 56 : 8, bottom: 0, left: 0 }}
        barCategoryGap="18%"
      >
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28} {...AXIS} />
        <YAxis
          tickFormatter={compact}
          domain={[0, ticks[ticks.length - 1]!]}
          ticks={ticks}
          width={56}
          axisLine={false}
          {...AXIS}
        />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          content={({ active, payload }) => {
            const d = active ? (payload?.[0]?.payload as ProgressDay | undefined) : undefined;
            const v = d?.[field];
            if (!d || v === null || v === undefined) return null;
            return <TooltipBox date={d.date} rows={[{ label: unit, value: num(v), color }]} />;
          }}
        />
        {reference && (
          <ReferenceLine
            y={reference.value}
            stroke="var(--ink-3)"
            strokeWidth={1.5}
            label={{
              value: reference.label,
              position: 'right',
              fill: 'var(--ink-2)',
              fontSize: 12,
              fontWeight: 800,
            }}
          />
        )}
        <Bar
          dataKey={field}
          fill={color}
          maxBarSize={24}
          radius={[4, 4, 0, 0]}
          isAnimationActive={!reduced()}
          animationDuration={700}
        />
      </BarChart>
    </Frame>
  );
}

/** Расчётный максимум по дням тренировок одного упражнения; пунктир — цель. */
export function StrengthChart({ series }: { series: StrengthSeries }) {
  if (series.points.length === 0) {
    return (
      <p className="chart-empty">
        Точек пока нет: они появятся после тренировок с этим упражнением и проходки.
      </p>
    );
  }
  const values = series.points.map((p) => p.e1rm);
  if (series.goalKg) values.push(series.goalKg);
  const lo = Math.floor(Math.min(...values) * 0.95);
  const hi = Math.ceil(Math.max(...values) * 1.03);
  return (
    <Frame height={200}>
      <LineChart data={series.points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...AXIS} />
        <YAxis domain={[lo, hi]} width={44} axisLine={false} {...AXIS} />
        <Tooltip
          cursor={{ stroke: 'var(--line-2)', strokeWidth: 1 }}
          content={({ active, payload }) => {
            const p = active
              ? (payload?.[0]?.payload as { date: string; e1rm: number } | undefined)
              : undefined;
            if (!p) return null;
            return (
              <TooltipBox
                date={p.date}
                rows={[{ label: 'Максимум', value: `${num(p.e1rm)} кг`, color: 'var(--primary)' }]}
              />
            );
          }}
        />
        {series.goalKg && (
          <ReferenceLine
            y={series.goalKg}
            stroke="var(--green)"
            strokeWidth={2}
            strokeDasharray="6 5"
            label={{
              value: `цель ${num(series.goalKg)}`,
              position: 'insideTopRight',
              fill: 'var(--ink-2)',
              fontSize: 12,
              fontWeight: 800,
            }}
          />
        )}
        <Line
          dataKey="e1rm"
          type="monotone"
          stroke="var(--primary)"
          strokeWidth={2.5}
          dot={{ r: 5, fill: 'var(--primary)', stroke: 'var(--surface)', strokeWidth: 2 }}
          activeDot={{ r: 7, fill: 'var(--primary)', stroke: 'var(--surface)', strokeWidth: 2 }}
          isAnimationActive={!reduced()}
          animationDuration={900}
        />
      </LineChart>
    </Frame>
  );
}
