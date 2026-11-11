import { athleteCardSchema, type AthleteCard } from '@trektren/shared';
import type { FieldDef, SectionDef } from './sections';

export interface InjuryDraft {
  area: string;
  description: string;
  since: string;
}

export interface InjuriesDraft {
  /** Человек явно подтвердил, что травм нет: это заполненный раздел, а не пустой. */
  none: boolean;
  items: InjuryDraft[];
}

export type Draft = Record<string, unknown>;
export type FieldErrors = Record<string, string>;

type SectionObject = Record<string, unknown> | undefined;

const editableFields = (def: SectionDef) => def.fields.filter((f) => f.kind !== 'readonly');

/** Значения карточки → состояние формы (числа как строки, списки тегов как текст). */
export function toDraft(def: SectionDef, card: AthleteCard): Draft {
  const section = card[def.key] as SectionObject;
  const draft: Draft = {};
  for (const field of editableFields(def)) {
    const value = section?.[field.key];
    draft[field.key] = toDraftValue(field, value);
  }
  return draft;
}

function toDraftValue(field: FieldDef, value: unknown): unknown {
  switch (field.kind) {
    case 'number':
      return typeof value === 'number' ? String(value).replace('.', ',') : '';
    case 'date':
    case 'text':
    case 'textarea':
      return typeof value === 'string' ? value : '';
    case 'tags':
      return Array.isArray(value) ? value.join(', ') : '';
    case 'multi':
    case 'weekdays':
      return Array.isArray(value) ? value : [];
    case 'injuries': {
      const items = Array.isArray(value) ? (value as Array<Record<string, string>>) : undefined;
      return {
        none: items !== undefined && items.length === 0,
        items: (items ?? []).map((i) => ({
          area: i.area ?? '',
          description: i.description ?? '',
          since: i.since ?? '',
        })),
      } satisfies InjuriesDraft;
    }
    default:
      return value;
  }
}

/** Состояние формы → значения раздела; пустое поле = undefined (ключ удаляется). */
function fromDraftValue(field: FieldDef, value: unknown): unknown {
  switch (field.kind) {
    case 'number': {
      const text = String(value ?? '')
        .trim()
        .replace(',', '.')
        .replace(/\s/g, '');
      if (text === '') return undefined;
      const n = Number(text);
      // Нечисло уходит строкой: схема вернёт понятное «Нужно число».
      return Number.isFinite(n) ? n : text;
    }
    case 'date':
    case 'text':
    case 'textarea': {
      const text = String(value ?? '').trim();
      return text === '' ? undefined : text;
    }
    case 'tags': {
      const items = String(value ?? '')
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      return items.length > 0 ? items : undefined;
    }
    case 'multi':
    case 'weekdays': {
      const items = Array.isArray(value) ? [...value] : [];
      if (field.kind === 'weekdays') items.sort((a, b) => Number(a) - Number(b));
      return items.length > 0 ? items : undefined;
    }
    case 'segmented':
      return value === '' || value === null ? undefined : value;
    case 'injuries': {
      const draft = value as InjuriesDraft;
      const items = draft.items
        .filter((i) => i.area.trim() || i.description.trim())
        .map((i) => ({
          area: i.area.trim(),
          description: i.description.trim(),
          ...(i.since ? { since: i.since } : {}),
        }));
      if (items.length > 0) return items;
      return draft.none ? [] : undefined;
    }
    default:
      return undefined;
  }
}

export interface PreparedSave {
  /** Патч для PATCH /card или null, если ничего не изменилось. */
  patch: Record<string, unknown> | null;
  errors: FieldErrors;
}

/** Собирает патч раздела и проверяет его той же схемой, что и сервер. */
export function prepareSave(def: SectionDef, card: AthleteCard, draft: Draft): PreparedSave {
  const original = (card[def.key] as SectionObject) ?? {};
  const sectionPatch: Record<string, unknown> = {};
  const merged: Record<string, unknown> = { ...original };

  for (const field of editableFields(def)) {
    const next = fromDraftValue(field, draft[field.key]);
    if (next !== undefined) {
      sectionPatch[field.key] = next;
      merged[field.key] = next;
    } else if (original[field.key] !== undefined) {
      sectionPatch[field.key] = null;
      delete merged[field.key];
    }
  }

  const schema = athleteCardSchema.shape[def.key];
  const result = schema.safeParse(merged);
  if (!result.success) {
    const errors: FieldErrors = {};
    for (const issue of result.error.issues) {
      errors[issue.path.join('.')] ??= issue.message;
    }
    return { patch: null, errors };
  }

  const unchanged = Object.entries(sectionPatch).every(
    ([k, v]) => JSON.stringify(v) === JSON.stringify(original[k] ?? null),
  );
  return { patch: unchanged ? null : { [def.key]: sectionPatch }, errors: {} };
}

/** Ошибки сервера 'basics.heightCm' → ошибки полей раздела 'heightCm'. */
export function sectionErrors(section: string, serverErrors: FieldErrors): FieldErrors {
  const prefix = `${section}.`;
  const result: FieldErrors = {};
  for (const [path, message] of Object.entries(serverErrors)) {
    if (path.startsWith(prefix)) result[path.slice(prefix.length)] = message;
  }
  return result;
}
