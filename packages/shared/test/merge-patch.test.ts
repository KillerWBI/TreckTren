import { describe, expect, it } from 'vitest';
import { applyMergePatch, canonicalJson, topLevelPatch } from '../src/merge-patch.js';
import { athleteCardSchema } from '../src/athlete-card.js';
import { enableRussianZodErrors } from '../src/zod-ru.js';

describe('applyMergePatch (RFC 7386)', () => {
  it('сливает вложенные объекты', () => {
    const target = { basics: { heightCm: 180, weightKg: 80 }, goals: { primary: 'strength' } };
    const patch = { basics: { weightKg: 82 } };
    expect(applyMergePatch(target, patch)).toEqual({
      basics: { heightCm: 180, weightKg: 82 },
      goals: { primary: 'strength' },
    });
  });

  it('null удаляет ключ', () => {
    expect(applyMergePatch({ a: 1, b: { c: 2, d: 3 } }, { b: { c: null } })).toEqual({
      a: 1,
      b: { d: 3 },
    });
  });

  it('массивы заменяются целиком', () => {
    expect(applyMergePatch({ days: [1, 3, 5] }, { days: [3, 6] })).toEqual({ days: [3, 6] });
  });

  it('не мутирует исходный объект', () => {
    const target = { basics: { heightCm: 180 } };
    applyMergePatch(target, { basics: { heightCm: 181 } });
    expect(target.basics.heightCm).toBe(180);
  });

  it('отклоняет __proto__', () => {
    const patch = JSON.parse('{"__proto__": {"polluted": true}}') as unknown;
    expect(() => applyMergePatch({}, patch)).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('canonicalJson и topLevelPatch', () => {
  it('не зависит от порядка ключей', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('строит патч только по изменённым разделам', () => {
    const from = {
      basics: { heightCm: 180 },
      goals: { primary: 'strength' },
      nutrition: { mealsPerDay: 4 },
    };
    const to = { basics: { heightCm: 180 }, goals: { primary: 'hypertrophy' } };
    const patch = topLevelPatch(from, to);
    expect(patch).toEqual({ goals: { primary: 'hypertrophy' }, nutrition: null });
    expect(applyMergePatch(from, patch)).toEqual(to);
  });
});

describe('русские ошибки', () => {
  it('понятные сообщения вместо технических', () => {
    enableRussianZodErrors();
    const result = athleteCardSchema.safeParse({
      availability: { sessionsPerWeek: 9 },
      basics: { birthDate: 'x' },
    });
    const messages = result.error?.issues.map((i) => i.message);
    expect(messages).toEqual(expect.arrayContaining(['Не больше 7', 'Нужна дата']));
  });
});

describe('athleteCardSchema', () => {
  it('принимает пустую карточку', () => {
    expect(athleteCardSchema.parse({})).toEqual({});
  });

  it('отклоняет неизвестный ключ', () => {
    expect(athleteCardSchema.safeParse({ basics: { heigth: 180 } }).success).toBe(false);
  });

  it('проверяет диапазоны', () => {
    expect(athleteCardSchema.safeParse({ availability: { sessionsPerWeek: 9 } }).success).toBe(
      false,
    );
    expect(
      athleteCardSchema.safeParse({ availability: { sessionsPerWeek: 3, usualDays: [3, 6] } })
        .success,
    ).toBe(true);
  });
});
