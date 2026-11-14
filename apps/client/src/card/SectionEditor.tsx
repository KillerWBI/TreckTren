import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AthleteCard } from '@trektren/shared';
import { ApiError, fieldErrorsFrom } from '../api/http';
import { prepareSave, sectionErrors, toDraft, type Draft, type FieldErrors } from './draft';
import { Field } from './fields';
import type { SectionDef } from './sections';
import { CARD_KEY, useSaveCard } from './useSaveCard';

interface Props {
  def: SectionDef;
  card: AthleteCard;
  version: number;
  onClose: (saved: boolean) => void;
}

export function SectionEditor({ def, card, version, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(def, card));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSaveCard();
  const queryClient = useQueryClient();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const prepared = prepareSave(def, card, draft);
    setErrors(prepared.errors);
    if (Object.keys(prepared.errors).length > 0) {
      setFormError('Исправь отмеченные поля.');
      return;
    }
    if (!prepared.patch) {
      onClose(false);
      return;
    }
    save.mutate(
      { patch: prepared.patch, baseVersion: version },
      {
        onSuccess: () => onClose(true),
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
            setFormError(
              'Профиль изменился на другом устройстве. Я подтянул новую версию — проверь и сохрани снова.',
            );
            void queryClient.invalidateQueries({ queryKey: CARD_KEY });
            return;
          }
          const fieldErrors = sectionErrors(def.key, fieldErrorsFrom(err));
          setErrors(fieldErrors);
          setFormError(
            Object.keys(fieldErrors).length > 0
              ? 'Исправь отмеченные поля.'
              : err instanceof Error
                ? err.message
                : 'Не получилось сохранить.',
          );
        },
      },
    );
  };

  return (
    <form className="editor" onSubmit={onSubmit} noValidate>
      {def.fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={
            field.kind === 'readonly'
              ? (card[def.key] as Record<string, unknown> | undefined)?.[field.key]
              : draft[field.key]
          }
          error={errors[field.key]}
          errors={errors}
          onChange={(value) => setDraft((d) => ({ ...d, [field.key]: value }))}
        />
      ))}
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
