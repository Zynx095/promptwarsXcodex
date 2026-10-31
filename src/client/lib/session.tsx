// Client-side session state. This only drives navigation; the server enforces all access.
// For workers, a small snapshot of who is signed in (name, role, organisation; no tokens) is kept
// on the phone so the app can open without a connection and save check-ins for later. Nothing is
// sent with it: the server still checks the session cookie on every request once back online.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, UNAUTHENTICATED_EVENT } from './api';
import { clearLocalWorkerData } from './outbox';
import type { MeResponse } from '../../shared/types';

interface Session {
  me: MeResponse | null;
  loading: boolean;
  error: ApiError | null;
  /** True while showing the saved snapshot because the server could not be reached. */
  offline: boolean;
  refresh: () => Promise<void>;
  logout: (opts?: { clearLocal?: boolean }) => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);
const SNAPSHOT_KEY = 'fairshift.session';

function saveSnapshot(me: MeResponse | null) {
  try {
    if (me && me.user.role === 'worker') {
      const { user, org, demoMode } = me;
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ user, org, demoMode }));
    } else localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* storage unavailable */
  }
}

function loadSnapshot(): MeResponse | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    const snap = raw ? (JSON.parse(raw) as MeResponse) : null;
    return snap?.user?.role === 'worker' ? snap : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [offline, setOffline] = useState(false);

  const accept = useCallback((m: MeResponse) => {
    setMe(m);
    setOffline(false);
    setError(null);
    saveSnapshot(m);
  }, []);

  /** Network failure: open with the saved worker snapshot if there is one. */
  const fallBack = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 0) {
      const snap = loadSnapshot();
      if (snap) {
        setMe(snap);
        setOffline(true);
        setError(null);
        return;
      }
    }
    setMe(null);
    setOffline(false);
    if (e instanceof ApiError && e.status !== 401) setError(e);
    if (e instanceof ApiError && e.status === 401) saveSnapshot(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      accept(await api<MeResponse>('/auth/me'));
    } catch (e) {
      fallBack(e);
    } finally {
      setLoading(false);
    }
  }, [accept, fallBack]);

  const logout = useCallback(
    async (opts: { clearLocal?: boolean } = {}) => {
      const userId = me?.user.id;
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
      saveSnapshot(null);
      if (userId && opts.clearLocal !== false) clearLocalWorkerData(userId);
      setMe(null);
      setOffline(false);
    },
    [me],
  );

  useEffect(() => {
    // Initial session load; state is set from the promise callbacks, not synchronously.
    let active = true;
    api<MeResponse>('/auth/me')
      .then((m) => active && accept(m))
      .catch((e: unknown) => active && fallBack(e))
      .finally(() => active && setLoading(false));
    const onUnauth = () => {
      setMe(null);
      setOffline(false);
      saveSnapshot(null);
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauth);
    return () => {
      active = false;
      window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauth);
    };
  }, [accept, fallBack]);

  // Back online after opening from the snapshot: confirm the session with the server
  useEffect(() => {
    if (!offline) return;
    const onOnline = () => void refresh();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [offline, refresh]);

  return <SessionContext.Provider value={{ me, loading, error, offline, refresh, logout }}>{children}</SessionContext.Provider>;
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
