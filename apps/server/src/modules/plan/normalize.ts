import {
  blockTemplateSchema,
  textLiftSchema,
  textTargetSchema,
  type BlockTemplate,
  type TextFacts,
} from '@trektren/shared';
import type { Exercise } from '../exercises/repo.js';

export type NormalizeResult =
  { ok: true; template: BlockTemplate; warnings: string[] } | { ok: false; errors: string[] };

/**
 * Проверяет шаблон от ИИ по схеме и по нашей базе. Мелочи чинит сама
 * (неизвестные упражнения, перепутанные повторы, неделя не той длины),
 * грубые ошибки возвращает — их отправляем модели на исправление.
 */
export function normalizeTemplate(raw: unknown, available: Exercise[]): NormalizeResult {
  // Цифры из текста проверяем поштучно: одна странная цифра не должна валить весь план.
  let facts: TextFacts | undefined;
  if (raw && typeof raw === 'object' && 'fromText' in raw) {
    const { fromText, ...rest } = raw as Record<string, unknown>;
    facts = cleanFacts(fromText);
    raw = rest;
  }
  const parsed = blockTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'ответ'}: ${i.message}`),
    };
  }
  const t = structuredClone(parsed.data);
  const known = new Map(available.map((e) => [e.slug, e]));
  const warnings: string[] = [];
  const errors: string[] = [];

  const keys = new Set<string>();
  for (const session of t.sessions) {
    if (keys.has(session.key)) errors.push(`Ключ тренировки ${session.key} повторяется`);
    keys.add(session.key);

    const seen = new Set<string>();
    session.exercises = session.exercises.filter((x) => {
      if (!known.has(x.slug)) {
        warnings.push(`${session.key}: упражнения ${x.slug} нет в списке — убрано`);
        return false;
      }
      if (seen.has(x.slug)) return false;
      seen.add(x.slug);
      return true;
    });
    for (const x of session.exercises) {
      if (x.repsMin > x.repsMax) [x.repsMin, x.repsMax] = [x.repsMax, x.repsMin];
    }
    if (session.exercises.length < 2) {
      errors.push(`В тренировке ${session.key} меньше двух упражнений из списка`);
    }
  }

  t.rotation = t.rotation.filter((k) => keys.has(k));
  if (t.rotation.length === 0) t.rotation = t.sessions.map((s) => s.key);
  for (const key of keys) {
    if (!t.rotation.includes(key)) t.rotation.push(key);
  }

  // Число недельных правил должно совпасть с длиной блока.
  while (t.weeks.length < t.accumulationWeeks) t.weeks.push({ ...t.weeks[t.weeks.length - 1]! });
  t.weeks = t.weeks.slice(0, t.accumulationWeeks);

  if (facts) t.fromText = facts;
  return errors.length > 0 ? { ok: false, errors } : { ok: true, template: t, warnings };
}

function cleanFacts(value: unknown): TextFacts | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { lifts?: unknown; targets?: unknown };
  const pick = <T>(
    list: unknown,
    schema: { safeParse: (x: unknown) => { success: boolean; data?: T } },
  ) =>
    (Array.isArray(list) ? list : []).flatMap((item) => {
      const r = schema.safeParse(item);
      return r.success ? [r.data as T] : [];
    });
  const lifts = pick(v.lifts, textLiftSchema).slice(0, 20);
  const targets = pick(v.targets, textTargetSchema).slice(0, 10);
  if (lifts.length === 0 && targets.length === 0) return undefined;
  return { lifts, targets };
}
