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

function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'loading') return <Splash />;
  if (state.status === 'guest') return <Navigate to="/login" replace />;
  return children;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'loading') return <Splash />;
  if (state.status === 'authed') return <Navigate to="/" replace />;
  return children;
}

function Shell() {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark wordmark-small">TreckTren</span>
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
