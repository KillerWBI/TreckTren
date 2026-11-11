/**
 * JSON Merge Patch (RFC 7386): объекты сливаются рекурсивно, null удаляет ключ,
 * массивы и примитивы заменяются целиком. Так ИИ и человек правят карточку атлета.
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const result: Record<string, unknown> = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Недопустимый ключ в патче: ${key}`);
    }
    if (value === null) {
      delete result[key];
    } else {
      result[key] = applyMergePatch(result[key], value);
    }
  }
  return result;
}

/** JSON с отсортированными ключами — для сравнения документов независимо от порядка ключей. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Патч верхнего уровня, который переводит `from` в `to`:
 * изменённые разделы целиком, удалённые разделы — null.
 */
export function topLevelPatch(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const key of keys) {
    if (canonicalJson(from[key]) !== canonicalJson(to[key])) {
      patch[key] = to[key] === undefined ? null : to[key];
    }
  }
  return patch;
}
