import { ApiError } from '../api/http';

export function Loading({ text }: { text: string }) {
  return (
    <main className="page">
      <p className="state" role="status">
        {text}…
      </p>
    </main>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof ApiError ? error.message : 'Не получилось загрузить данные.';
  return (
    <main className="page">
      <div className="state" role="alert">
        <p>{message}</p>
        <button type="button" className="button" onClick={onRetry}>
          Повторить
        </button>
      </div>
    </main>
  );
}
