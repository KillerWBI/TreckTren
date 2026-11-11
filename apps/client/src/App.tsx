import type { ReactNode } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AccountPage } from './pages/AccountPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CardPage } from './pages/CardPage';
import { HistoryPage } from './pages/HistoryPage';

function Splash() {
  return (
    <main className="auth">
      <p className="wordmark">TreckTren</p>
    </main>
  );
}

function Offline() {
  const { retry } = useAuth();
  return (
    <main className="auth">
      <p className="wordmark">TreckTren</p>
      <div className="state" role="alert">
        <p>Нет связи с сервером. Проверь интернет и повтори.</p>
        <button type="button" className="button" onClick={retry}>
          Повторить
        </button>
      </div>
    </main>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'loading') return <Splash />;
  if (state.status === 'offline') return <Offline />;
  if (state.status === 'guest') return <Navigate to="/login" replace />;
  return children;
}

/** Экраны входа и регистрации: в демо-режиме их нет — сразу в приложение. */
function GuestOnly({ children }: { children: ReactNode }) {
  const { state, mode } = useAuth();
  if (state.status === 'loading') return <Splash />;
  if (state.status === 'offline') return <Offline />;
  if (state.status === 'authed' || mode === 'demo') return <Navigate to="/" replace />;
  return children;
}

function Shell() {
  const { mode } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark wordmark-small">TreckTren</span>
        {mode === 'demo' && <span className="topbar-note">Тестовый аккаунт</span>}
      </header>
      <Outlet />
      <nav className="tabbar" aria-label="Разделы приложения">
        <NavLink to="/" end>
          Карточка
        </NavLink>
        <NavLink to="/history">История</NavLink>
        <NavLink to="/account">Аккаунт</NavLink>
      </nav>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestOnly>
            <LoginPage />
          </GuestOnly>
        }
      />
      <Route
        path="/register"
        element={
          <GuestOnly>
            <RegisterPage />
          </GuestOnly>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<CardPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
