import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onFlushed, useOnline, useOutbox } from './outbox';
import { plural } from '../format';

/** Плашка внизу: «нет сети, записи ждут». Когда очередь ушла — обновляем данные экранов. */
export function OfflineBanner() {
  const online = useOnline();
  const queue = useOutbox();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      onFlushed(() => {
        void queryClient.invalidateQueries();
      }),
    [queryClient],
  );

  if (online && queue.length === 0) return null;
  const n = queue.length;
  const count = `${plural(n, ['ждёт', 'ждут', 'ждут'])} ${n} ${plural(n, ['запись', 'записи', 'записей'])}`;
  const text = online
    ? `Отправляю ${n} ${plural(n, ['запись', 'записи', 'записей'])}`
    : n > 0
      ? `Нет сети. На телефоне ${count}, отправлю сам`
      : 'Нет сети. Записи сохранятся на телефоне';
  return (
    <p className="offline-banner" role="status">
      {text}
    </p>
  );
}
