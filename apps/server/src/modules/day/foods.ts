import type { AthleteCard, FoodSuggestion } from '@trektren/shared';

interface Food {
  name: string;
  /** На 100 г. */
  protein: number;
  kcal: number;
  /** Округление порции: яйца — штуками, остальное — по 10 г. */
  unitG?: number;
  tags: string[];
}

/** Простые источники белка. Исключения из карточки убирают свои группы. */
const FOODS: Food[] = [
  { name: 'Творог 5%', protein: 17, kcal: 121, tags: ['молоч', 'творог'] },
  { name: 'Греческий йогурт 2%', protein: 10, kcal: 73, tags: ['молоч', 'йогурт'] },
  { name: 'Яйца', protein: 12.6, kcal: 157, unitG: 55, tags: ['яйц'] },
  { name: 'Куриная грудка', protein: 23, kcal: 113, tags: ['мяс', 'куриц'] },
  { name: 'Тунец в собственном соку', protein: 24, kcal: 110, tags: ['рыб', 'тунец'] },
  { name: 'Сывороточный протеин', protein: 75, kcal: 380, tags: ['протеин', 'добавк'] },
  { name: 'Чечевица варёная', protein: 9, kcal: 116, tags: ['бобов', 'чечевиц'] },
  { name: 'Тофу', protein: 12, kcal: 120, tags: ['соя', 'тофу'] },
];

/**
 * Чем добрать белок до нормы: 3 варианта на недостающие граммы (не больше 40 г за раз),
 * без того, что человек не ест.
 */
export function proteinSuggestions(card: AthleteCard, missingProteinG: number): FoodSuggestion[] {
  if (missingProteinG < 15) return [];
  const excluded = (card.nutrition?.excludedFoods ?? []).map((e) => e.toLowerCase());
  const target = Math.min(40, missingProteinG);
  return FOODS.filter(
    (f) =>
      !excluded.some((e) => f.tags.some((t) => e.includes(t)) || f.name.toLowerCase().includes(e)),
  )
    .slice(0, 3)
    .map((f) => {
      const step = f.unitG ?? 10;
      const grams = Math.max(step, Math.round(((target / f.protein) * 100) / step) * step);
      return {
        name: f.unitG ? `${f.name}, ${grams / f.unitG} шт.` : f.name,
        grams,
        proteinG: Math.round((f.protein * grams) / 100),
        kcal: Math.round((f.kcal * grams) / 100),
      };
    });
}
