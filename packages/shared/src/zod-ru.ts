import { z } from 'zod';

/**
 * Человеческие сообщения об ошибках на русском — одинаковые на сервере и в клиенте.
 * Сообщения, заданные прямо в схеме, важнее этой карты.
 */
export const ruErrorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'too_big':
      if (issue.origin === 'string') return `Не длиннее ${issue.maximum} символов`;
      if (issue.origin === 'array') return `Не больше ${issue.maximum} вариантов`;
      return `Не больше ${issue.maximum}`;
    case 'too_small':
      if (issue.origin === 'string')
        return issue.minimum === 1 ? 'Заполни поле' : `Минимум ${issue.minimum} символов`;
      if (issue.origin === 'array') return `Выбери хотя бы ${issue.minimum}`;
      return `Не меньше ${issue.minimum}`;
    case 'invalid_type':
      if (issue.expected === 'number' || issue.expected === 'int') return 'Нужно число';
      if (issue.expected === 'boolean') return 'Выбери да или нет';
      return 'Неверное значение';
    case 'invalid_format':
      if (issue.format === 'date') return 'Нужна дата';
      if (issue.format === 'email') return 'Некорректный email';
      return 'Неверный формат';
    case 'invalid_value':
      return 'Выбери вариант из списка';
    case 'unrecognized_keys':
      return `Лишние поля: ${issue.keys.join(', ')}`;
    case 'not_multiple_of':
      return `Шаг — ${String(issue.divisor)}`;
    default:
      return undefined;
  }
};

/** Включает русские сообщения для всех схем zod в процессе. */
export function enableRussianZodErrors(): void {
  z.config({ customError: ruErrorMap });
}
