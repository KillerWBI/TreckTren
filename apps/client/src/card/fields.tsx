import { useId } from 'react';
import { WEEKDAY_SHORT } from './labels';
import type { InjuriesDraft } from './draft';
import type { FieldDef } from './sections';

interface FieldProps {
  field: FieldDef;
  value: unknown;
  error?: string | undefined;
  errors: Record<string, string>;
  onChange: (value: unknown) => void;
}

export function Field({ field, value, error, errors, onChange }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hint = 'hint' in field ? field.hint : undefined;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;

  const footer = (
    <>
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </>
  );

  switch (field.kind) {
    case 'number':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <div className="input-unit">
            <input
              id={id}
              inputMode="decimal"
              autoComplete="off"
              value={String(value ?? '')}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              onChange={(e) => onChange(e.target.value)}
            />
            {field.unit && <span className="unit">{field.unit}</span>}
          </div>
          {footer}
        </div>
      );
    case 'date':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <input
            id={id}
            type="date"
            value={String(value ?? '')}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          />
          {footer}
        </div>
      );
    case 'text':
    case 'tags':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <input
            id={id}
            value={String(value ?? '')}
            placeholder={field.placeholder}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          />
          {footer}
        </div>
      );
    case 'textarea':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <textarea
            id={id}
            rows={3}
            value={String(value ?? '')}
            placeholder={field.placeholder}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          />
          {footer}
        </div>
      );
    case 'segmented':
      return (
        <fieldset className="field">
          <legend>{field.label}</legend>
          <div className="chips" role="radiogroup">
            {field.options.map((opt) => {
              const selected = value === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="chip"
                  onClick={() => onChange(selected ? undefined : opt.value)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {footer}
        </fieldset>
      );
    case 'multi': {
      const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
      const full = field.max !== undefined && selected.size >= field.max;
      return (
        <fieldset className="field">
          <legend>
            {field.label}
            {field.max !== undefined && <span className="legend-note"> до {field.max}</span>}
          </legend>
          <div className="chips">
            {field.options.map((opt) => {
              const on = selected.has(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={on}
                  className="chip"
                  disabled={!on && full}
                  onClick={() => {
                    const next = new Set(selected);
                    if (on) next.delete(opt.value);
                    else next.add(opt.value);
                    onChange(field.options.map((o) => o.value).filter((v) => next.has(v)));
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {footer}
        </fieldset>
      );
    }
    case 'weekdays': {
      const selected = new Set(Array.isArray(value) ? (value as number[]) : []);
      return (
        <fieldset className="field">
          <legend>{field.label}</legend>
          <div className="weekdays">
            {WEEKDAY_SHORT.map((label, i) => {
              const day = i + 1;
              const on = selected.has(day);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  className="chip chip-day"
                  onClick={() => {
                    const next = new Set(selected);
                    if (on) next.delete(day);
                    else next.add(day);
                    onChange([...next].sort((a, b) => a - b));
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {footer}
        </fieldset>
      );
    }
    case 'injuries':
      return (
        <InjuriesField
          label={field.label}
          value={value as InjuriesDraft}
          errors={errors}
          onChange={onChange}
        />
      );
    case 'readonly':
      return (
        <div className="field field-readonly">
          <span className="readonly-label">{field.label}</span>
          <span>{field.format(value)}</span>
        </div>
      );
  }
}

function InjuriesField({
  label,
  value,
  errors,
  onChange,
}: {
  label: string;
  value: InjuriesDraft;
  errors: Record<string, string>;
  onChange: (value: InjuriesDraft) => void;
}) {
  const update = (index: number, patch: Partial<InjuriesDraft['items'][number]>) =>
    onChange({
      ...value,
      items: value.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });

  return (
    <fieldset className="field">
      <legend>{label}</legend>
      {value.items.length === 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={value.none}
            onChange={(e) => onChange({ ...value, none: e.target.checked })}
          />
          <span>Травм и болей нет</span>
        </label>
      )}
      {value.items.map((item, index) => (
        <div className="injury" key={index}>
          <div className="field">
            <label htmlFor={`injury-area-${index}`}>Где</label>
            <input
              id={`injury-area-${index}`}
              value={item.area}
              placeholder="Плечо, поясница, колено"
              aria-invalid={Boolean(errors[`injuries.${index}.area`])}
              onChange={(e) => update(index, { area: e.target.value })}
            />
            {errors[`injuries.${index}.area`] && (
              <p className="field-error">{errors[`injuries.${index}.area`]}</p>
            )}
          </div>
          <div className="field">
            <label htmlFor={`injury-desc-${index}`}>Что именно</label>
            <textarea
              id={`injury-desc-${index}`}
              rows={2}
              value={item.description}
              placeholder="Когда болит, какие движения мешают"
              aria-invalid={Boolean(errors[`injuries.${index}.description`])}
              onChange={(e) => update(index, { description: e.target.value })}
            />
            {errors[`injuries.${index}.description`] && (
              <p className="field-error">{errors[`injuries.${index}.description`]}</p>
            )}
          </div>
          <button
            type="button"
            className="link-button"
            onClick={() => onChange({ ...value, items: value.items.filter((_, i) => i !== index) })}
          >
            Убрать
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button-secondary button-small"
        onClick={() =>
          onChange({
            none: false,
            items: [...value.items, { area: '', description: '', since: '' }],
          })
        }
      >
        Добавить травму
      </button>
    </fieldset>
  );
}
