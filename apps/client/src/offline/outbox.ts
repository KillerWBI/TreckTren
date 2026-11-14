import { useSyncExternalStore } from 'react';
import { get, set } from 'idb-keyval';
import { api, ApiError } from '../api/http';

/**
 * Очередь записей без сети: подходы, вес, шаги, сон. Все они — upsert по дате или
 * номеру подхода, поэтому повторная отправка ничего не задвоит.
 * Хранится в IndexedDB, переживает закрытие вкладки, уходит при появлении сети.
 */
export interface OutboxItem {
  id: string;
  /** Ключ «что это»: новая запись того же ключа заменяет старую в очереди. */
  key: string;
  path: string;
  method: 'PUT' | 'POST';
  json: unknown;
  createdAt: string;
}

const STORE_KEY = 'trecktren-outbox';
let items: OutboxItem[] = [];
let loaded = false;
let flushing: Promise<void> | null = null;
const listeners = new Set<() => void>();
const flushedListeners = new Set<(items: OutboxItem[]) => void>();

function emit() {
  for (const l of listeners) l();
}

async function load(): Promise<void> {
  if (loaded) return;
  try {
    items = (await get<OutboxItem[]>(STORE_KEY)) ?? [];
  } catch {
    items = [];
  }
  loaded = true;
  emit();
}

async function persist(): Promise<void> {
  try {
    await set(STORE_KEY, items);
  } catch {
    // IndexedDB недоступен (приватный режим): очередь живёт до закрытия вкладки.
  }
  emit();
}

const isNetwork = (err: unknown) => err instanceof ApiError && err.status === 0;

/** Отправить сразу; без сети — поставить в очередь. queued: true — запись ждёт сети. */
export async function sendOrQueue<T>(
  key: string,
  path: string,
  method: 'PUT' | 'POST',
  json: unknown,
): Promise<{ queued: false; data: T } | { queued: true }> {
  try {
    return { queued: false, data: await api<T>(path, { method, json }) };
  } catch (err) {
    if (!isNetwork(err)) throw err;
    await load();
    items = [
      ...items.filter((i) => i.key !== key),
      { id: crypto.randomUUID(), key, path, method, json, createdAt: new Date().toISOString() },
    ];
    await persist();
    return { queued: true };
  }
}

/** Отправить очередь по порядку. Сеть снова пропала — остановиться; 4xx — выкинуть запись. */
export function flushOutbox(): Promise<void> {
  flushing ??= (async () => {
    await load();
    const sent: OutboxItem[] = [];
    for (const item of [...items]) {
      try {
        await api(item.path, { method: item.method, json: item.json });
        sent.push(item);
      } catch (err) {
        if (isNetwork(err)) break;
        if (err instanceof ApiError && err.status >= 500) break;
        sent.push(item); // сервер отказал по сути (тренировку удалили и т. п.) — не крутим вечно
      }
      items = items.filter((i) => i.id !== item.id);
      await persist();
    }
    if (sent.length) for (const l of flushedListeners) l(sent);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export function onFlushed(listener: (items: OutboxItem[]) => void): () => void {
  flushedListeners.add(listener);
  return () => flushedListeners.delete(listener);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

export const outboxItems = (): OutboxItem[] => items;

export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(subscribe, () => items);
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
  );
}

/** Запуск: отправить хвост с прошлого раза, потом — при каждом появлении сети. */
export function startOutbox(): void {
  void flushOutbox();
  window.addEventListener('online', () => void flushOutbox());
  window.setInterval(() => {
    if (items.length && navigator.onLine) void flushOutbox();
  }, 30_000);
}
