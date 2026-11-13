import { useState } from 'react';
import type { DayResponse, MealItem, MealType } from '@trektren/shared';
import { ApiError } from '../api/http';
import { num } from '../format';
import { useAddMeal, useParseMeal } from './useDay';

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

/** Тип приёма по времени суток — чтобы не выбирать каждый раз. */
export function mealTypeNow(): MealType {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

interface ItemRow {
  name: string;
  grams: string;
  kcal: string;
  proteinG: string;
  fatG: string;
  carbsG: string;
}

const EMPTY: ItemRow = { name: '', grams: '', kcal: '', proteinG: '', fatG: '', carbsG: '' };
const toRow = (i: MealItem): ItemRow => ({
  name: i.name,
  grams: String(i.grams),
  kcal: String(i.kcal),
  proteinG: String(i.proteinG).replace('.', ','),
  fatG: String(i.fatG).replace('.', ','),
  carbsG: String(i.carbsG).replace('.', ','),
});
const n = (s: string) => {
  const t = s.trim().replace(',', '.');
  return t === '' ? 0 : Number(t);
};

/**
 * Добавить приём пищи: фразой («200 г риса и 2 яйца» — ИИ разберёт, ты поправишь),
 * вручную по продуктам или повтором частого.
 */
export function MealForm({
  date,
  day,
  aiEnabled,
}: {
  date: string;
  day: DayResponse;
  aiEnabled: boolean;
}) {
  const add = useAddMeal(date);
  const parse = useParseMeal();
  const [mealType, setMealType] = useState<MealType>(mealTypeNow);
  const [mode, setMode] = useState<'text' | 'manual'>(aiEnabled ? 'text' : 'manual');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ItemRow[] | null>(mode === 'manual' ? [EMPTY] : null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const reset = () => {
    setText('');
    setNote('');
    setRows(mode === 'manual' ? [EMPTY] : null);
  };

  const runParse = () => {
    setError('');
    parse.mutate(text, {
      onSuccess: (food) => {
        setRows(food.items.map(toRow));
        setNote(food.note ?? '');
      },
      onError: (err) =>
        setError(err instanceof ApiError ? err.message : 'Не получилось разобрать.'),
    });
  };

  const save = () => {
    setError('');
    const items: MealItem[] = [];
    for (const r of rows ?? []) {
      if (!r.name.trim()) continue;
      const item = {
        name: r.name.trim(),
        grams: n(r.grams),
        kcal: n(r.kcal),
        proteinG: n(r.proteinG),
        fatG: n(r.fatG),
        carbsG: n(r.carbsG),
      };
      if (Object.values(item).some((v) => typeof v === 'number' && !(v >= 0 && v <= 10000))) {
        return setError(`${item.name}: числа от 0 до 10 000.`);
      }
      items.push(item);
    }
    if (items.length === 0) return setError('Добавь хотя бы один продукт с названием.');
    const title =
      mode === 'text' && text.trim() ? text.trim() : items.map((i) => i.name).join(', ');
    add.mutate(
      { mealType, inputType: mode, title: title.slice(0, 200), items },
      {
        onSuccess: reset,
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Не сохранилось.'),
      },
    );
  };

  const repeat = (meal: DayResponse['recentMeals'][number]) =>
    add.mutate({ mealType, inputType: 'manual', title: meal.title, items: meal.items });

  const set = (i: number, key: keyof ItemRow, value: string) =>
    setRows((list) => (list ?? []).map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  return (
    <div className="meal-form">
      <div className="chips" role="radiogroup" aria-label="Приём пищи">
        {(Object.keys(MEAL_LABELS) as MealType[]).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={mealType === t}
            className="chip"
            onClick={() => setMealType(t)}
          >
            {MEAL_LABELS[t]}
          </button>
        ))}
      </div>

      {day.recentMeals.length > 0 && (
        <div className="recent-meals">
          <span className="field-hint">Повторить:</span>
          <div className="chips">
            {day.recentMeals.map((m) => (
              <button
                key={m.title}
                type="button"
                className="chip chip-meal"
                onClick={() => repeat(m)}
                disabled={add.isPending}
              >
                {m.title.length > 34 ? `${m.title.slice(0, 32)}…` : m.title}
                <span className="chip-kcal">{num(m.totals.kcal)} ккал</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="segmented" role="tablist" aria-label="Как вписать">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'text'}
          onClick={() => {
            setMode('text');
            setRows(null);
          }}
        >
          Фразой
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'manual'}
          onClick={() => {
            setMode('manual');
            setRows((r) => r ?? [EMPTY]);
          }}
        >
          Вручную
        </button>
      </div>

      {mode === 'text' && (
        <div className="field">
          <label htmlFor="meal-text">Что съел</label>
          <textarea
            id="meal-text"
            rows={2}
            maxLength={500}
            placeholder="Например: 200 г гречки, 2 яйца и огурец"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {!aiEnabled && <span className="field-hint">ИИ не подключён — впиши вручную.</span>}
          <button
            type="button"
            className="button button-small button-secondary"
            onClick={runParse}
            disabled={parse.isPending || text.trim().length < 2 || !aiEnabled}
          >
            {parse.isPending ? 'Считаю…' : 'Посчитать'}
          </button>
        </div>
      )}

      {rows && (
        <div className="meal-items">
          {note && <p className="plan-hint">{note}</p>}
          {rows.map((r, i) => (
            <fieldset key={i} className="meal-item">
              <legend className="visually-hidden">Продукт {i + 1}</legend>
              <label className="meal-name">
                <span className="set-label">Продукт</span>
                <input value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
              </label>
              {(
                [
                  ['grams', 'г'],
                  ['kcal', 'ккал'],
                  ['proteinG', 'Б'],
                  ['fatG', 'Ж'],
                  ['carbsG', 'У'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="meal-num">
                  <span className="set-label">{label}</span>
                  <input
                    inputMode="decimal"
                    value={r[key]}
                    onChange={(e) => set(i, key, e.target.value)}
                  />
                </label>
              ))}
            </fieldset>
          ))}
          <button
            type="button"
            className="link-button"
            onClick={() => setRows((l) => [...(l ?? []), EMPTY])}
          >
            Добавить продукт
          </button>
          <div className="editor-actions">
            <button type="button" className="button" onClick={save} disabled={add.isPending}>
              {add.isPending ? 'Сохраняю…' : `Записать в «${MEAL_LABELS[mealType].toLowerCase()}»`}
            </button>
            <button type="button" className="button button-secondary" onClick={reset}>
              Очистить
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
