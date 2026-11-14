import type { ReactNode } from 'react';

interface RingProps {
  /** Доля 0…1; больше 1 — перебор, кольцо краснеет. */
  share: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
  label: string;
}

/** Кольцо прогресса: заполняется плавно при каждом изменении. */
export function Ring({ share, size = 168, stroke = 16, children, label }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const over = share > 1;
  const shown = Math.max(0, Math.min(1, share));
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="ring-fill"
          data-over={over || undefined}
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
