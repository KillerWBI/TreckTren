import type {
  EQUIPMENT_ITEMS,
  JOB_TYPES,
  LEVELS,
  MUSCLE_GROUPS,
  PRIMARY_GOALS,
  SEXES,
  TRAINING_LOCATIONS,
  WEAK_POINT_STATUSES,
} from '@trektren/shared';

type Labels<T extends readonly string[]> = Record<T[number], string>;

export const SEX_LABELS: Labels<typeof SEXES> = { male: 'Мужской', female: 'Женский' };

export const GOAL_LABELS: Labels<typeof PRIMARY_GOALS> = {
  strength: 'Сила',
  hypertrophy: 'Масса',
  strength_hypertrophy: 'Сила и масса',
  fat_loss: 'Сушка',
  recomp: 'Рекомпозиция',
  general_fitness: 'Общая форма',
};

export const MUSCLE_LABELS: Labels<typeof MUSCLE_GROUPS> = {
  chest: 'Грудь',
  back: 'Спина',
  shoulders: 'Плечи',
  biceps: 'Бицепс',
  triceps: 'Трицепс',
  forearms: 'Предплечья',
  traps: 'Трапеции',
  abs: 'Пресс',
  quads: 'Квадрицепс',
  hamstrings: 'Бицепс бедра',
  glutes: 'Ягодицы',
  calves: 'Икры',
};

export const EQUIPMENT_LABELS: Labels<typeof EQUIPMENT_ITEMS> = {
  barbell: 'Штанга',
  rack: 'Стойка для приседа',
  bench: 'Скамья',
  dumbbells: 'Гантели',
  cable: 'Блоки',
  machines: 'Тренажёры',
  leg_press: 'Жим ногами',
  smith: 'Смит',
  pullup_bar: 'Турник',
  dip_bars: 'Брусья',
  kettlebells: 'Гири',
  bands: 'Резинки',
};

export const LOCATION_LABELS: Labels<typeof TRAINING_LOCATIONS> = { gym: 'Зал', home: 'Дом' };

export const JOB_LABELS: Labels<typeof JOB_TYPES> = {
  sedentary: 'Сидячая',
  mixed: 'Смешанная',
  on_feet: 'На ногах',
};

export const TECHNIQUE_LABELS: Labels<typeof LEVELS> = {
  low: 'Слабо',
  medium: 'Средне',
  high: 'Уверенно',
};
export const STRESS_LABELS: Labels<typeof LEVELS> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
};
export const BUDGET_LABELS: Labels<typeof LEVELS> = {
  low: 'Экономный',
  medium: 'Средний',
  high: 'Без ограничений',
};

export const WEAK_STATUS_LABELS: Labels<typeof WEAK_POINT_STATUSES> = {
  suspected: 'Подозрение',
  testing: 'Проверяем',
  confirmed: 'Подтверждено',
  resolved: 'Закрыто',
};

export const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const;

export const SOURCE_LABELS = { onboarding: 'Онбординг', user: 'Ты', ai: 'ИИ-тренер' } as const;

export function options<T extends string>(labels: Record<T, string>) {
  return (Object.entries(labels) as Array<[T, string]>).map(([value, label]) => ({ value, label }));
}
