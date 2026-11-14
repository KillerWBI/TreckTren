import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { CalendarDays, ChartLine, House, Settings, UserRound } from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import { Logo } from './components/Logo';
import { OfflineBanner } from './offline/OfflineBanner';
import { UpdateBanner } from './offline/UpdateBanner';
import { AccountPage } from './pages/AccountPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CardPage } from './pages/CardPage';
import { HistoryPage } from './pages/HistoryPage';
import { PlanPage } from './pages/PlanPage';
import { TodayPage } from './pages/TodayPage';
import { WorkoutPage } from './pages/WorkoutPage';

function Splash() {
  return (
    <main className="auth">
      <Logo />
    </main>
  );
}

function Offline() {
  const { retry } = useAuth();
  return (
    <main className="auth">
      <Logo />
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

// Графики (recharts) тяжёлые — грузятся, только когда открыли «Прогресс».
const ProgressPage = lazy(() =>
  import('./pages/ProgressPage').then((m) => ({ default: m.ProgressPage })),
);

const NAV = [
  { to: '/', label: 'Сегодня', icon: House, end: true },
  { to: '/plan', label: 'План', icon: CalendarDays, end: false },
  { to: '/progress', label: 'Прогресс', icon: ChartLine, end: false },
  { to: '/card', label: 'Профиль', icon: UserRound, end: false },
] as const;

function NavItem({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink to={to} end={end} className="nav-link">
      <span className="nav-icon" aria-hidden="true">
        <Icon size={22} strokeWidth={2.4} />
      </span>
      {label}
    </NavLink>
  );
}

/**
 * Телефон — нижние вкладки, ПК (от 1024 px) — боковое меню.
 * Сверху ничего нет: экран начинается сразу с заголовка раздела.
 */
function Shell() {
  const { mode } = useAuth();
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Разделы приложения">
        <Logo />
        {NAV.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
        <div className="sidebar-foot">
          <NavLink to="/account" className="nav-link">
            <span className="nav-icon" aria-hidden="true">
              <Settings size={22} strokeWidth={2.4} />
            </span>
            Аккаунт
          </NavLink>
          {mode === 'demo' && <span className="demo-badge">Тестовый аккаунт, общий для всех</span>}
        </div>
      </nav>
      <Outlet />
      <nav className="tabbar" aria-label="Разделы приложения">
        {NAV.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>
      <OfflineBanner />
      <UpdateBanner />
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
        <Route index element={<TodayPage />} />
        <Route path="/card" element={<CardPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/workout/:id" element={<WorkoutPage />} />
        <Route
          path="/progress"
          element={
            <Suspense fallback={<p className="page state">Загружаю графики…</p>}>
              <ProgressPage />
            </Suspense>
          }
        />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
