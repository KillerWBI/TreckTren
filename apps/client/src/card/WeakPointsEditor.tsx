import { useState, type FormEvent } from 'react';
import { athleteCardSchema, WEAK_POINT_STATUSES, type AthleteCard } from '@trektren/shared';
import { ApiError, fieldErrorsFrom } from '../api/http';
import { todayIso } from '../format';
import { WEAK_STATUS_LABELS } from './labels';
import { useSaveCard } from './useSaveCard';

type WeakPoint = NonNullable<AthleteCard['weakPoints']>[number];

interface ItemDraft {
  id: string | null;
  area: string;
  cause: string;
  status: WeakPoint['status'];
  original: WeakPoint | null;
}

const newId = () => `wp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Props {
  card: AthleteCard;
  version: number;
  onClose: (saved: boolean) => void;
}

export function WeakPointsEditor({ card, version, onClose }: Props) {
  const [items, setItems] = useState<ItemDraft[]>(() =>
    (card.weakPoints ?? []).map((p) => ({
      id: p.id,
      area: p.area,
      cause: p.cause ?? '',
      status: p.status,
      original: p,
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSaveCard();

  const update = (index: number, patch: Partial<ItemDraft>) =>
    setItems((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const today = todayIso();
    const next: WeakPoint[] = items
      .filter((i) => i.area.trim() || i.cause.trim())
      .map((i) => {
        const base = {
          id: i.id ?? newId(),
          area: i.area.trim(),
          ...(i.cause.trim() ? { cause: i.cause.trim() } : {}),
          status: i.status,
          source: i.original?.source ?? 'user',
        } as const;
        const same =
          i.original &&
          i.original.area === base.area &&
          (i.original.cause ?? '') === (base.cause ?? '') &&
          i.original.status === base.status;
        return { ...base, updatedAt: same ? i.original!.updatedAt : today };
      });

    const result = athleteCardSchema.shape.weakPoints.safeParse(next);
    if (!result.success) {
      const map: Record<string, string> = {};
      for (const issue of result.error.issues) map[issue.path.join('.')] ??= issue.message;
      setErrors(map);
      setFormError('Исправь отмеченные поля.');
      return;
    }
    setErrors({});
    if (JSON.stringify(next) === JSON.stringify(card.weakPoints ?? [])) {
      onClose(false);
      return;
    }
    save.mutate(
      { patch: { weakPoints: next.length > 0 ? next : null }, baseVersion: version },
      {
        onSuccess: () => onClose(true),
        onError: (err) => {
          const map = fieldErrorsFrom(err);
          setErrors(
            Object.fromEntries(
              Object.entries(map).map(([k, v]) => [k.replace(/^weakPoints\./, ''), v]),
            ),
          );
          setFormError(err instanceof ApiError ? err.message : 'Не получилось сохранить.');
        },
      },
    );
  };

  return (
    <form className="editor" onSubmit={onSubmit} noValidate>
      {items.length === 0 && (
        <p className="editor-note">
          Напиши, что отстаёт: движение или мышцу. Например: «присед застревает внизу».
        </p>
      )}
      {items.map((item, index) => (
        <fieldset className="field weak-point" key={item.id ?? `new-${index}`}>
          <legend>
            {item.original?.source === 'ai' ? 'Нашёл тренер' : `Слабое место ${index + 1}`}
          </legend>
          <div className="field">
            <label htmlFor={`wp-area-${index}`}>Что отстаёт</label>
            <input
              id={`wp-area-${index}`}
              value={item.area}
              placeholder="Присед, жим лёжа, задние дельты"
              aria-invalid={Boolean(errors[`${index}.area`])}
              onChange={(e) => update(index, { area: e.target.value })}
            />
            {errors[`${index}.area`] && <p className="field-error">{errors[`${index}.area`]}</p>}
          </div>
          <div className="field">
            <label htmlFor={`wp-cause-${index}`}>Где срывается или почему</label>
            <textarea
              id={`wp-cause-${index}`}
              rows={2}
              value={item.cause}
              placeholder="Застревает внизу, заваливается корпус"
              onChange={(e) => update(index, { cause: e.target.value })}
            />
          </div>
          <div className="chips" role="radiogroup" aria-label="Статус">
            {WEAK_POINT_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={item.status === status}
                className="chip"
                onClick={() => update(index, { status })}
              >
                {WEAK_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="link-button"
            onClick={() => setItems((list) => list.filter((_, i) => i !== index))}
          >
            Убрать
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="button button-secondary button-small"
        disabled={items.length >= 20}
        onClick={() =>
          setItems((list) => [
            ...list,
            { id: null, area: '', cause: '', status: 'suspected', original: null },
          ])
        }
      >
        Добавить слабое место
      </button>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <div className="editor-actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {save.isPending ? 'Сохраняю…' : 'Сохранить раздел'}
        </button>
        <button type="button" className="button button-secondary" onClick={() => onClose(false)}>
          Отмена
        </button>
      </div>
    </form>
  );
}
