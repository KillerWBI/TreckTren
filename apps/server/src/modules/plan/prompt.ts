import type { AthleteCard, BlockTemplate } from '@trektren/shared';
import type { ChatMessage } from '../../ai/client.js';
import type { Exercise } from '../exercises/repo.js';
import type { ScheduleInfo } from './schedule.js';

const SYSTEM = `Ты — строгий персональный тренер в приложении TreckTren. Составляешь шаблон тренировочного блока под конкретного человека. Отвечаешь только JSON по заданной схеме, без текста вокруг. Все тексты — на русском.

Правила:
- Используй только упражнения из списка. Поле slug пиши ровно как в списке.
- Сплит выбирай по числу тренировок в неделю и промежуткам между ними: 1–2 в неделю — фулбади A/B; 3 — фулбади A/B/C или верх/низ/фулбади; 4 — верх/низ ×2; 5–6 — толкай/тяни/ноги. Если тренировки бывают в соседние дни, сделай соседние по ротации тренировки на разные мышцы.
- Объём: 10–20 рабочих подходов на мышцу в неделю для массы, у приоритетных мышц — ближе к верхней границе. Не больше 6 тяжёлых подходов на одну мышцу за тренировку.
- Повторы под цель: сила — базовые 3–6, подсобка 6–10; масса — базовые 6–10, подсобка 10–15; сила и масса — базовые 4–6, подсобка 8–12; сушка — интенсивность в базовых та же, объём на 20–30% меньше.
- Тренировка должна укладываться во время из карточки: примерно 2,5 минуты на подход плюс 10 минут разминки.
- accumulationWeeks — 3–5 недель накопления. weeks — по одному правилу на неделю: rir (запас повторов) от 3 к 1, extraSets — добавочные подходы 0–2. Разгрузочную неделю после блока код добавит сам.
- sessions — 1–6 разных тренировок с ключами A, B, C…; rotation — порядок их чередования.
- Учитывай травмы и ограничения: упражнения, которые нельзя, уже убраны из списка. Не перегружай больную зону.
- Веса в килограммах не пиши: их посчитает код по максимумам.
- note у упражнения — короткая техническая подсказка, только если она важна.
- rationale — 2–5 предложений: почему такой сплит, объём и повторы. coachNote — одно-два коротких жёстких предложения человеку, без похвалы.
- Если есть комментарий человека — выполни его, если он не противоречит безопасности; если противоречит — объясни это в rationale.`;

interface PromptInput {
  card: AthleteCard;
  schedule: ScheduleInfo;
  available: Exercise[];
  knownMaxes: Record<string, number>;
  previous?: BlockTemplate | undefined;
  comment?: string | undefined;
}

/** Компактный промпт: упражнения строками, карточка без служебных разделов. */
export function buildPlanMessages(input: PromptInput): ChatMessage[] {
  const { coachNotes: _notes, forecast: _forecast, ...card } = input.card;
  const exercises = input.available
    .map(
      (e) =>
        `${e.slug} | ${e.name} | ${e.pattern} | ${e.primaryMuscles.join(',')}${e.isCompound ? ' | базовое' : ''}`,
    )
    .join('\n');

  const parts = [
    `Карточка атлета (JSON):\n${JSON.stringify(card)}`,
    `Выбранные дни тренировок: ${input.schedule.dates.join(', ')}.\nПромежутки между ними, дней: ${input.schedule.gaps.join(', ') || '—'}. В среднем тренировок в неделю: ${input.schedule.perWeek}.`,
    `Известные максимумы (1ПМ, кг): ${
      Object.keys(input.knownMaxes).length > 0
        ? JSON.stringify(input.knownMaxes)
        : 'нет — первая неделя калибровочная'
    }`,
    `Доступные упражнения (slug | название | паттерн | основные мышцы):\n${exercises}`,
  ];
  if (input.previous) {
    const summary = input.previous.sessions
      .map(
        (s) =>
          `${s.key} «${s.title}»: ${s.exercises.map((x) => `${x.slug} ${x.sets}×${x.repsMin}-${x.repsMax}`).join(', ')}`,
      )
      .join('\n');
    parts.push(`Текущий план (${input.previous.split}), его нужно перестроить:\n${summary}`);
  }
  if (input.comment) parts.push(`Комментарий человека к плану: ${input.comment}`);

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: parts.join('\n\n') },
  ];
}
