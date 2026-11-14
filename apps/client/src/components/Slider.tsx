import { useId, type CSSProperties } from 'react';
import { num } from '../format';

interface SliderProps {
  label: string;
  /** null — ещё не выбрано: ползунок серый, значение не показано. */
  value: number | null;
  min: number;
  max: number;
  step?: number;
  /** Начальное положение ручки, пока значения нет. */
  placeholder?: number;
  unit?: string;
  /** Подпись под ползунком для текущего значения: «Хорошо выспался». */
  caption?: (value: number) => string | undefined;
  /** Подписи концов шкалы. */
  ends?: [string, string];
  onChange: (value: number) => void;
  /** Отпустил ручку — можно сохранять. */
  onCommit?: (value: number) => void;
}

/** Крупный ползунок для пальца: значение справа, подпись под шкалой. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  placeholder,
  unit,
  caption,
  ends,
  onChange,
  onCommit,
}: SliderProps) {
  const id = useId();
  const shown = value ?? placeholder ?? min;
  const fill = ((shown - min) / (max - min)) * 100;
  const text = value === null ? undefined : caption?.(value);
  const commit = (e: { currentTarget: HTMLInputElement }) =>
    onCommit?.(Number(e.currentTarget.value));

  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id} className="slider-label">
          {label}
        </label>
        <span className="slider-value" data-empty={value === null || undefined} aria-hidden="true">
          {value === null ? 'не отмечено' : `${num(value)}${unit ? ` ${unit}` : ''}`}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        data-empty={value === null || undefined}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        aria-valuetext={
          value === null
            ? 'не отмечено'
            : `${num(value)}${unit ? ` ${unit}` : ''}${text ? `, ${text}` : ''}`
        }
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onTouchEnd={commit}
      />
      {ends && (
        <div className="slider-ticks" aria-hidden="true">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
      <p className="slider-caption">{text ?? ''}</p>
    </div>
  );
}
