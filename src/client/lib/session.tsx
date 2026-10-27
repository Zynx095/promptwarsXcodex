// Client-side session state. This only drives navigation; the server enforces all access.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, UNAUTHENTICATED_EVENT } from './api';
import type { MeResponse } from '../../shared/types';

interface Session {
  me: MeResponse | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<MeResponse>('/auth/me'));
      setError(null);
    } catch (e) {
      setMe(null);
      if (e instanceof ApiError && e.status !== 401) setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    // Initial session load; state is set from the promise callbacks, not synchronously.
    let active = true;
    api<MeResponse>('/auth/me')
      .then((m) => active && setMe(m))
      .catch((e: unknown) => {
        if (active && e instanceof ApiError && e.status !== 401) setError(e);
      })
      .finally(() => active && setLoading(false));
    const onUnauth = () => setMe(null);
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauth);
    return () => {
      active = false;
      window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauth);
    };
  }, []);

  return <SessionContext.Provider value={{ me, loading, error, refresh, logout }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}

/** The signed-in user's session; only call inside routes that require sign-in. */
export function useMe(): MeResponse {
  const { me } = useSession();
  if (!me) throw new Error('useMe without a session');
  return me;
}
