import { useRegisterSW } from 'virtual:pwa-register/react';

/** Проверять обновления раз в 30 минут, пока приложение открыто. */
const CHECK_MS = 30 * 60 * 1000;

/** Плашка «Вышла новая версия»: обновление по нажатию, чтобы не сбить запись тренировки. */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => void registration.update().catch(() => undefined), CHECK_MS);
    },
  });

  if (!needRefresh) return null;
  return (
    <div className="update-banner" role="status">
      <span>Вышла новая версия приложения</span>
      <button
        type="button"
        className="button button-small"
        onClick={() => void updateServiceWorker(true)}
      >
        Обновить
      </button>
      <button type="button" className="link-button" onClick={() => setNeedRefresh(false)}>
        Позже
      </button>
    </div>
  );
}
