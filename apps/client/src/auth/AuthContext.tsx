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
import type { AuthResponse, LoginRequest, PublicUser, RegisterRequest } from '@trektren/shared';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from '../api/http';

type AuthState =
  { status: 'loading' } | { status: 'guest' } | { status: 'authed'; user: PublicUser };

interface AuthContextValue {
  state: AuthState;
  login: (input: LoginRequest) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  /** После удаления аккаунта: сбросить сессию без запроса к серверу. */
  forget: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const queryClient = useQueryClient();

  const forget = useCallback(() => {
    setAccessToken(null);
    queryClient.clear();
    setState({ status: 'guest' });
  }, [queryClient]);

  useEffect(() => {
    setSessionLostHandler(forget);
    let cancelled = false;
    void refreshSession().then((session) => {
      if (cancelled) return;
      setState(session ? { status: 'authed', user: session.user } : { status: 'guest' });
    });
    return () => {
      cancelled = true;
    };
  }, [forget]);

  const start = useCallback((session: AuthResponse) => {
    setAccessToken(session.accessToken);
    setState({ status: 'authed', user: session.user });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
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
    [state, start, forget],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}
