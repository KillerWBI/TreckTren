import {
  EQUIPMENT_ITEMS,
  MUSCLE_GROUPS,
  PRIMARY_GOALS,
  type AthleteCard,
  type USER_EDITABLE_SECTIONS,
} from '@trektren/shared';
import { ageFrom, formatDate, num, plural } from '../format';
import {
  BUDGET_LABELS,
  EQUIPMENT_LABELS,
  GOAL_LABELS,
  JOB_LABELS,
  LOCATION_LABELS,
  MUSCLE_LABELS,
  options,
  SEX_LABELS,
  STRESS_LABELS,
  TECHNIQUE_LABELS,
  WEAK_STATUS_LABELS,
  WEEKDAY_SHORT,
} from './labels';
import {
  Bandage,
  CalendarDays,
  Crosshair,
  Dumbbell,
  Footprints,
  Medal,
  Moon,
  Ruler,
  Target,
  Utensils,
  type LucideIcon,
} from 'lucide-react';

export type SectionKey = (typeof USER_EDITABLE_SECTIONS)[number];

interface Option<V> {
  value: V;
  label: string;
}

export type FieldDef =
  | { kind: 'number'; key: string; label: string; unit?: string; step?: number; hint?: string }
  | { kind: 'date'; key: string; label: string; hint?: string }
  | { kind: 'text'; key: string; label: string; placeholder?: string }
  | { kind: 'textarea'; key: string; label: string; placeholder?: string }
  | { kind: 'segmented'; key: string; label: string; options: Option<string | boolean>[] }
  | {
      kind: 'multi';
      key: string;
      label: string;
      options: Option<string>[];
      max?: number;
      hint?: string;
    }
  | { kind: 'weekdays'; key: string; label: string; hint?: string }
  | { kind: 'tags'; key: string; label: string; placeholder?: string; hint?: string }
  | { kind: 'injuries'; key: string; label: string }
  | { kind: 'readonly'; key: string; label: string; format: (value: unknown) => string };

export interface SectionDef {
  key: SectionKey;
  title: string;
  icon: LucideIcon;
  required: boolean;
  /** Зачем раздел тренеру — показывается, пока он пустой. */
  why: string;
  fields: FieldDef[];
  summary: (card: AthleteCard) => string;
}

/** Склеивает непустые строки; false, 0 и undefined из условий отбрасываются. */
const join = (parts: unknown[]) =>
  parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(', ');
const list = (items: string[] | undefined, labels?: Record<string, string>) =>
  (items ?? []).map((i) => labels?.[i] ?? i).join(', ');

export const SECTIONS: SectionDef[] = [
  {
    key: 'goals',
    title: 'Цели',
    icon: Target,
    required: true,
    why: 'Без цели нет плана: от неё зависят повторы, объём и калории.',
    fields: [
      { kind: 'segmented', key: 'primary', label: 'Главная цель', options: options(GOAL_LABELS) },
      {
        kind: 'multi',
        key: 'secondary',
        label: 'Второстепенные цели',
        options: PRIMARY_GOALS.map((g) => ({ value: g, label: GOAL_LABELS[g] })),
        max: 3,
      },
      {
        kind: 'multi',
        key: 'priorityMuscles',
        label: 'Что подтянуть в первую очередь',
        options: MUSCLE_GROUPS.map((m) => ({ value: m, label: MUSCLE_LABELS[m] })),
        hint: 'Эти мышцы получат объём у верхней границы.',
      },
      {
        kind: 'date',
        key: 'deadline',
        label: 'К какой дате',
        hint: 'Если срок нереален, тренер скажет прямо.',
      },
      {
        kind: 'textarea',
        key: 'notes',
        label: 'Своими словами',
        placeholder: 'Например: присед 140 кг к лету, жим 100 кг',
      },
    ],
    summary: ({ goals: g }) =>
      join([
        g?.primary && GOAL_LABELS[g.primary],
        g?.secondary?.length && `плюс ${list(g.secondary, GOAL_LABELS).toLowerCase()}`,
        g?.priorityMuscles?.length &&
          `приоритет: ${list(g.priorityMuscles, MUSCLE_LABELS).toLowerCase()}`,
        g?.deadline && `к ${formatDate(g.deadline)}`,
      ]),
  },
  {
    key: 'basics',
    title: 'Базовое',
    icon: Ruler,
    required: true,
    why: 'Рост, вес и возраст нужны для нормы калорий и оценки потолка.',
    fields: [
      { kind: 'segmented', key: 'sex', label: 'Пол', options: options(SEX_LABELS) },
      { kind: 'date', key: 'birthDate', label: 'Дата рождения' },
      { kind: 'number', key: 'heightCm', label: 'Рост', unit: 'см', step: 1 },
      {
        kind: 'number',
        key: 'weightKg',
        label: 'Вес',
        unit: 'кг',
        step: 0.1,
        hint: 'Утренний, натощак.',
      },
      {
        kind: 'number',
        key: 'bodyFatPct',
        label: 'Процент жира',
        unit: '%',
        step: 0.5,
        hint: 'Если не знаешь — оставь пустым, посчитаем по замерам.',
      },
    ],
    summary: ({ basics: b }) =>
      join([
        b?.sex && SEX_LABELS[b.sex],
        b?.birthDate &&
          `${ageFrom(b.birthDate)} ${plural(ageFrom(b.birthDate), ['год', 'года', 'лет'])}`,
        b?.heightCm && `${num(b.heightCm)} см`,
        b?.weightKg && `${num(b.weightKg)} кг`,
        b?.bodyFatPct && `жир ${num(b.bodyFatPct)}%`,
      ]),
  },
  {
    key: 'availability',
    title: 'Дни и время',
    icon: CalendarDays,
    required: true,
    why: 'Число тренировок решает сплит и восстановление между ними.',
    fields: [
      {
        kind: 'number',
        key: 'sessionsPerWeek',
        label: 'Тренировок в неделю',
        unit: 'раз',
        step: 1,
      },
      {
        kind: 'number',
        key: 'sessionMinutes',
        label: 'Длительность тренировки',
        unit: 'мин',
        step: 5,
      },
      {
        kind: 'weekdays',
        key: 'usualDays',
        label: 'Обычно свободные дни',
        hint: 'Точные даты ставишь в календаре, здесь — как обычно получается.',
      },
    ],
    summary: ({ availability: a }) =>
      join([
        a?.sessionsPerWeek &&
          `${a.sessionsPerWeek} ${plural(a.sessionsPerWeek, ['тренировка', 'тренировки', 'тренировок'])} в неделю`,
        a?.sessionMinutes && `по ${a.sessionMinutes} мин`,
        a?.usualDays?.length && `обычно ${a.usualDays.map((d) => WEEKDAY_SHORT[d - 1]).join(', ')}`,
      ]),
  },
  {
    key: 'equipment',
    title: 'Оборудование',
    icon: Dumbbell,
    required: true,
    why: 'Тренер подбирает только те упражнения, которые можно сделать.',
    fields: [
      {
        kind: 'segmented',
        key: 'location',
        label: 'Где тренируешься',
        options: options(LOCATION_LABELS),
      },
      {
        kind: 'multi',
        key: 'items',
        label: 'Что есть',
        options: EQUIPMENT_ITEMS.map((e) => ({ value: e, label: EQUIPMENT_LABELS[e] })),
      },
      { kind: 'number', key: 'dumbbellMaxKg', label: 'Гантели до', unit: 'кг', step: 0.5 },
      {
        kind: 'textarea',
        key: 'notes',
        label: 'Что ещё важно',
        placeholder: 'Например: нет стойки, только Смит',
      },
    ],
    summary: ({ equipment: e }) =>
      join([
        e?.location && LOCATION_LABELS[e.location],
        e?.items?.length && list(e.items, EQUIPMENT_LABELS).toLowerCase(),
        e?.dumbbellMaxKg && `гантели до ${num(e.dumbbellMaxKg)} кг`,
      ]),
  },
  {
    key: 'limitations',
    title: 'Травмы и ограничения',
    icon: Bandage,
    required: true,
    why: 'Через боль план не строится: такие движения тренер заменит.',
    fields: [
      { kind: 'injuries', key: 'injuries', label: 'Травмы и боли' },
      {
        kind: 'tags',
        key: 'bannedMovements',
        label: 'Что нельзя делать',
        placeholder: 'Через запятую: становая с пола, жим над головой',
      },
    ],
    summary: ({ limitations: l }) => {
      if (!l) return '';
      const injuries = l.injuries ?? [];
      const banned = l.bannedMovements ?? [];
      if (injuries.length === 0 && banned.length === 0) return 'Травм и ограничений нет';
      return join([
        injuries.map((i) => i.area).join(', '),
        banned.length > 0 && `нельзя: ${banned.join(', ')}`,
      ]);
    },
  },
  {
    key: 'experience',
    title: 'Опыт',
    icon: Medal,
    required: false,
    why: 'Стаж определяет темп прогресса и прогноз сроков.',
    fields: [
      { kind: 'number', key: 'trainingYears', label: 'Стаж в зале', unit: 'лет', step: 0.5 },
      {
        kind: 'segmented',
        key: 'techniqueConfidence',
        label: 'Техника базовых движений',
        options: options(TECHNIQUE_LABELS),
      },
      { kind: 'textarea', key: 'pastPrograms', label: 'По каким программам занимался' },
      {
        kind: 'textarea',
        key: 'breaks',
        label: 'Перерывы',
        placeholder: 'Например: полгода не тренировался в 2025',
      },
    ],
    summary: ({ experience: e }) =>
      join([
        e?.trainingYears !== undefined &&
          `стаж ${num(e.trainingYears)} ${plural(Math.ceil(e.trainingYears), ['год', 'года', 'лет'])}`,
        e?.techniqueConfidence &&
          `техника: ${TECHNIQUE_LABELS[e.techniqueConfidence].toLowerCase()}`,
      ]),
  },
  {
    key: 'activity',
    title: 'Активность вне зала',
    icon: Footprints,
    required: false,
    why: 'Шаги и работа на ногах меняют норму калорий сильнее, чем кажется.',
    fields: [
      { kind: 'segmented', key: 'jobType', label: 'Работа', options: options(JOB_LABELS) },
      { kind: 'number', key: 'avgSteps', label: 'Шагов в день в среднем', step: 500 },
      {
        kind: 'textarea',
        key: 'otherSports',
        label: 'Другой спорт',
        placeholder: 'Бег, футбол, плавание',
      },
    ],
    summary: ({ activity: a }) =>
      join([
        a?.jobType && `работа: ${JOB_LABELS[a.jobType].toLowerCase()}`,
        a?.avgSteps !== undefined && `${a.avgSteps.toLocaleString('ru-RU')} шагов`,
        a?.otherSports,
      ]),
  },
  {
    key: 'nutrition',
    title: 'Питание',
    icon: Utensils,
    required: false,
    why: 'Чтобы рацион был реальным, а не идеальным на бумаге.',
    fields: [
      { kind: 'number', key: 'mealsPerDay', label: 'Приёмов пищи в день', step: 1 },
      {
        kind: 'tags',
        key: 'excludedFoods',
        label: 'Что не ешь',
        placeholder: 'Через запятую: молочное, свинина',
      },
      {
        kind: 'segmented',
        key: 'cooksSelf',
        label: 'Готовишь сам',
        options: [
          { value: true, label: 'Да' },
          { value: false, label: 'Нет' },
        ],
      },
      { kind: 'segmented', key: 'budget', label: 'Бюджет на еду', options: options(BUDGET_LABELS) },
    ],
    summary: ({ nutrition: n }) =>
      join([
        n?.mealsPerDay &&
          `${n.mealsPerDay} ${plural(n.mealsPerDay, ['приём', 'приёма', 'приёмов'])} в день`,
        n?.cooksSelf !== undefined && (n.cooksSelf ? 'готовит сам' : 'не готовит'),
        n?.excludedFoods?.length && `без: ${n.excludedFoods.join(', ')}`,
        n?.budget && `бюджет: ${BUDGET_LABELS[n.budget].toLowerCase()}`,
      ]),
  },
  {
    key: 'recovery',
    title: 'Сон и стресс',
    icon: Moon,
    required: false,
    why: 'При плохом сне тренер снижает нагрузку дня, а не ломает тебя.',
    fields: [
      { kind: 'number', key: 'typicalSleepHours', label: 'Обычно спишь', unit: 'ч', step: 0.5 },
      { kind: 'segmented', key: 'stress', label: 'Стресс', options: options(STRESS_LABELS) },
      {
        kind: 'readonly',
        key: 'avgSleepScore',
        label: 'Средняя оценка сна',
        format: (v) =>
          typeof v === 'number' ? `${num(v)} из 5` : 'Появится после первой недели отметок',
      },
    ],
    summary: ({ recovery: r }) =>
      join([
        r?.typicalSleepHours !== undefined && `сон ${num(r.typicalSleepHours)} ч`,
        r?.stress && `стресс ${STRESS_LABELS[r.stress].toLowerCase()}`,
        r?.avgSleepScore !== undefined && `оценка сна ${num(r.avgSleepScore)}`,
      ]),
  },
  {
    key: 'weakPoints',
    title: 'Слабые места',
    icon: Crosshair,
    required: false,
    why: 'Что отстаёт, по-твоему. Тренер проверит тестами и найдёт причину.',
    fields: [],
    summary: ({ weakPoints: w }) =>
      (w ?? []).map((p) => `${p.area} (${WEAK_STATUS_LABELS[p.status].toLowerCase()})`).join(', '),
  },
];

export function isFilled(card: AthleteCard, key: SectionKey): boolean {
  const value = card[key];
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}
