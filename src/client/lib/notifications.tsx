// One shared copy of the signed-in user's notifications, so the bell, the notification sheet and
// the worker home agree on what is unread. The server stays the source of truth: marking read
// updates the list immediately and then reloads it.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { useApi } from './useApi';
import type { NotificationDTO, NotificationsResponse } from '../../shared/types';

interface Notifications {
  items: NotificationDTO[];
  unreadCount: number;
  loaded: boolean;
  failed: boolean;
  reload: () => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationsContext = createContext<Notifications | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const state = useApi<NotificationsResponse>('/notifications/mine');
  const [readLocally, setReadLocally] = useState<ReadonlySet<string>>(new Set());
  const [allReadAt, setAllReadAt] = useState<string | null>(null);
  const { reload } = state;

  const items = useMemo(
    () =>
      (state.data?.items ?? []).map((n) => (n.read || readLocally.has(n.id) || (allReadAt !== null && n.createdAt <= allReadAt) ? { ...n, read: true } : n)),
    [state.data, readLocally, allReadAt],
  );
  const unreadCount = items.filter((n) => !n.read).length;

  const markRead = useCallback(
    async (id: string) => {
      setReadLocally((prev) => new Set(prev).add(id));
      try {
        await api(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
      } finally {
        reload();
      }
    },
    [reload],
  );

  const markAllRead = useCallback(async () => {
    setAllReadAt(new Date().toISOString());
    try {
      await api('/notifications/read-all', { method: 'POST' });
    } finally {
      reload();
    }
  }, [reload]);

  const value = useMemo<Notifications>(
    () => ({ items, unreadCount, loaded: state.data !== null, failed: state.error !== null, reload, markRead, markAllRead }),
    [items, unreadCount, state.data, state.error, reload, markRead, markAllRead],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): Notifications {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications outside NotificationsProvider');
  return ctx;
}
