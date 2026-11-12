import { EQUIPMENT_ITEMS, type AthleteCard } from '@trektren/shared';
import type { Exercise } from '../exercises/repo.js';

export interface Availability {
  available: Exercise[];
  /** Что убрано и почему — показывается человеку под планом. */
  excluded: Array<{ slug: string; name: string; reason: 'equipment' | 'injury' | 'banned' }>;
}

/**
 * Какие упражнения человек может делать: есть оборудование, не задевает травмы
 * и не входит в его список «что нельзя». Через боль план не строится.
 */
export function filterAvailable(all: Exercise[], card: AthleteCard): Availability {
  const equipment = equipmentOf(card);
  const injuryText = (card.limitations?.injuries ?? [])
    .map((i) => `${i.area} ${i.description}`)
    .join(' ')
    .toLowerCase();
  const banned = (card.limitations?.bannedMovements ?? []).map((b) => b.toLowerCase());

  const available: Exercise[] = [];
  const excluded: Availability['excluded'] = [];
  for (const e of all) {
    const name = e.name.toLowerCase();
    if (!e.requires.every((item) => equipment.has(item))) {
      excluded.push({ slug: e.slug, name: e.name, reason: 'equipment' });
    } else if (e.contraindications.some((stem) => injuryText.includes(stem))) {
      excluded.push({ slug: e.slug, name: e.name, reason: 'injury' });
    } else if (banned.some((b) => name.includes(b) || b.includes(name))) {
      excluded.push({ slug: e.slug, name: e.name, reason: 'banned' });
    } else {
      available.push(e);
    }
  }
  return { available, excluded };
}

/** Оборудование из карточки. Зал без списка — считаем, что в нём есть всё. */
function equipmentOf(card: AthleteCard): Set<string> {
  const items = card.equipment?.items ?? [];
  if (items.length > 0) return new Set(items);
  if (card.equipment?.location === 'home') return new Set();
  return new Set(EQUIPMENT_ITEMS);
}
