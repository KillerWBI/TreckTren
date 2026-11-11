import type { CSSProperties } from 'react';
import { PLATES, plateFill, type PlateId } from '../card/plates';

export interface SleeveSlot {
  id: string;
  plate: PlateId;
  filled: boolean;
  label: string;
}

const HEIGHT = 150;
const MID = HEIGHT / 2;
const GAP = 3;
const START = 60;

/**
 * Втулка штанги сбоку: каждый заполненный раздел карточки — блин на своём месте,
 * пустой — контур. Всё заполнено — замок закрывает втулку.
 * Блин монтируется заново, когда раздел заполнили, и наезжает на втулку.
 */
export function Sleeve({ slots, title }: { slots: SleeveSlot[]; title: string }) {
  let x = START;
  const placed = slots.map((slot, index) => {
    const plate = PLATES[slot.plate];
    const at = x;
    x += plate.width + GAP;
    return { slot, plate, x: at, index };
  });
  const allFilled = slots.every((s) => s.filled);

  return (
    <svg className="sleeve" viewBox={`0 0 360 ${HEIGHT}`} role="img" aria-label={title}>
      <rect className="sleeve-bar" x="0" y={MID - 5} width="44" height="10" rx="2" />
      <rect className="sleeve-shoulder" x="44" y={MID - 20} width="12" height="40" rx="2" />
      <rect className="sleeve-shaft" x="56" y={MID - 9} width="296" height="18" rx="3" />
      {placed.map(({ slot, plate, x: px, index }) => (
        <rect
          key={`${slot.id}-${slot.filled ? 'on' : 'off'}`}
          className={`plate plate-${plate.color} ${slot.filled ? 'plate-arrive' : 'plate-empty'}`}
          style={{ '--i': index } as CSSProperties}
          x={px}
          y={MID - plate.height / 2}
          width={plate.width}
          height={plate.height}
          rx="4"
          fill={slot.filled ? plateFill[plate.color] : 'none'}
        >
          <title>{`${slot.label}: ${slot.filled ? 'заполнено' : 'пусто'}`}</title>
        </rect>
      ))}
      {allFilled && (
        <rect className="sleeve-collar" x={x + 4} y={MID - 20} width="18" height="40" rx="3" />
      )}
    </svg>
  );
}

/** Маленький блин рядом с названием раздела: тот же цвет и пропорции, что на втулке. */
export function PlateMark({ plate, filled }: { plate: PlateId; filled: boolean }) {
  const p = PLATES[plate];
  const scale = 0.24;
  const w = Math.max(5, p.width * scale);
  const h = p.height * scale;
  return (
    <svg className="plate-mark" width="12" height="34" viewBox="0 0 12 34" aria-hidden="true">
      <rect
        className={`plate plate-${p.color}${filled ? '' : ' plate-empty'}`}
        x={(12 - w) / 2}
        y={(34 - h) / 2}
        width={w}
        height={h}
        rx="1.5"
        fill={filled ? plateFill[p.color] : 'none'}
      />
    </svg>
  );
}
