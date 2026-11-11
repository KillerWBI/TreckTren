import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AuthMode,
  AuthModeResponse,
  AuthResponse,
  LoginRequest,
  PublicUser,
  RegisterRequest,
} from '@trektren/shared';
import {
  api,
  refreshSession,
  setAccessToken,
  setAuthMode,
  setSessionLostHandler,
} from '../api/http';

type AuthState =
  | { status: 'loading' }
  /** Сервер недоступен: показываем «Повторить», а не экран входа. */
  | { status: 'offline' }
  | { status: 'guest' }
  | { status: 'authed'; user: PublicUser };

interface AuthContextValue {
  state: AuthState;
  /** demo — без регистрации и входа, все в одном тестовом аккаунте. */
  mode: AuthMode;
  retry: () => void;
  login: (input: LoginRequest) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** После удаления аккаунта: сбросить сессию без запроса к серверу. */
  forget: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [mode, setMode] = useState<AuthMode>('password');
  const queryClient = useQueryClient();

  const boot = useCallback(async () => {
    setState({ status: 'loading' });
    let current: AuthMode;
    try {
      current = (await api<AuthModeResponse>('/auth/mode', { noRefresh: true })).mode;
    } catch {
      setState({ status: 'offline' });
      return;
    }
    setAuthMode(current);
    setMode(current);
    // В демо refreshSession сам откроет сессию тестового аккаунта, если её нет.
    const session = await refreshSession();
    if (session) setState({ status: 'authed', user: session.user });
    else setState({ status: current === 'demo' ? 'offline' : 'guest' });
  }, []);

  const forget = useCallback(() => {
    setAccessToken(null);
    queryClient.clear();
    setState({ status: 'guest' });
  }, [queryClient]);

  useEffect(() => {
    setSessionLostHandler(() => {
      setAccessToken(null);
      queryClient.clear();
      // В демо сессия теряется только без связи с сервером.
      setState((prev) =>
        prev.status === 'authed' && mode === 'demo' ? { status: 'offline' } : { status: 'guest' },
      );
    });
  }, [mode, queryClient]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const start = useCallback((session: AuthResponse) => {
    setAccessToken(session.accessToken);
    setState({ status: 'authed', user: session.user });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      mode,
      retry: () => void boot(),
      login: async (input) =>
        start(
          await api<AuthResponse>('/auth/login', { method: 'POST', json: input, noRefresh: true }),
        ),
      register: async (input) =>
        start(
          await api<AuthResponse>('/auth/register', {
            method: 'POST',
            json: input,
            noRefresh: true,
          }),
        ),
      logout: async () => {
        await api('/auth/logout', { method: 'POST', noRefresh: true }).catch(() => undefined);
        forget();
      },
      forget,
    }),
    [state, mode, boot, start, forget],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}
