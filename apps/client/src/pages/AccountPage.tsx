import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/http';
import { useAuth } from '../auth/AuthContext';

export function AccountPage() {
  const { state, mode } = useAuth();
  if (state.status !== 'authed') return null;
  return mode === 'demo' ? <DemoAccount /> : <PasswordAccount email={state.user.email} />;
}

/** Демо-режим: выхода и удаления нет — аккаунт общий для всех, у кого есть ссылка. */
function DemoAccount() {
  return (
    <main className="page">
      <h1 className="page-title">Аккаунт</h1>
      <p className="page-lead">
        Это тестовый аккаунт. Регистрация и вход пока выключены: все, у кого есть ссылка, попадают
        сюда и видят одни и те же данные. Не вноси ничего личного.
      </p>
    </main>
  );
}

function PasswordAccount({ email }: { email: string }) {
  const { logout, forget } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');

  const remove = useMutation({
    mutationFn: (pwd: string) => api('/account', { method: 'DELETE', json: { password: pwd } }),
    onSuccess: () => forget(),
  });

  const onDelete = (event: FormEvent) => {
    event.preventDefault();
    remove.mutate(password);
  };

  return (
    <main className="page">
      <h1 className="page-title">Аккаунт</h1>
      <dl className="account">
        <div>
          <dt>Email</dt>
          <dd>{email}</dd>
        </div>
      </dl>
      <button type="button" className="button button-secondary" onClick={() => void logout()}>
        Выйти
      </button>

      <section className="danger-zone" aria-labelledby="delete-heading">
        <h2 id="delete-heading" className="group-title">
          Удаление аккаунта
        </h2>
        <p>Удалятся карточка, все записи, история и фото. Вернуть их будет нельзя.</p>
        {!confirming ? (
          <button
            type="button"
            className="button button-danger"
            onClick={() => setConfirming(true)}
          >
            Удалить аккаунт
          </button>
        ) : (
          <form onSubmit={onDelete} className="editor" noValidate>
            <div className="field">
              <label htmlFor="delete-password">Пароль для подтверждения</label>
              <input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {remove.isError && (
              <p className="form-error" role="alert">
                {(remove.error as Error).message}
              </p>
            )}
            <div className="editor-actions">
              <button
                type="submit"
                className="button button-danger"
                disabled={!password || remove.isPending}
              >
                {remove.isPending ? 'Удаляю…' : 'Удалить навсегда'}
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setConfirming(false)}
              >
                Отмена
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
