// React side of the offline outbox: keeps the list in state, sends pending items when the phone
// comes back online (and every 30 seconds while any are waiting), and exposes the actions the
// offline panel offers (retry, remove, confirm with passkey).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { attendanceAssertion, isCancelled } from './passkey';
import { isOnline } from './online';
import {
  enqueue as enqueueItem,
  isUnsent,
  loadOutbox,
  OUTBOX_EVENT,
  processOutbox,
  removeItem,
  retryItem,
  type EnqueueResult,
  type OutboxItem,
  type Sender,
} from './outbox';
import type { SafetyReportDTO, ShiftDTO } from '../../shared/types';

const send: Sender = async (item, { withPasskey }) => {
  if (item.kind === 'report') {
    const created = await api<SafetyReportDTO>('/reports', { method: 'POST', body: item.report });
    return { id: created.id };
  }
  const body: Record<string, unknown> = { queuedAt: item.createdAt };
  if (item.kind === 'check-in' && item.siteCode) body.siteCode = item.siteCode;
  if (withPasskey) {
    try {
      body.passkey = await attendanceAssertion(item.kind);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(400, isCancelled(err) ? 'PASSKEY_CANCELLED' : 'PASSKEY_FAILED', 'The passkey check did not finish.');
    }
  }
  const shift = await api<ShiftDTO>(`/attendance/${item.kind}`, { method: 'POST', body });
  return { id: shift.id };
};

interface OutboxState {
  items: OutboxItem[];
  unsentCount: number;
  /** Increases each time an item is confirmed by the server, so screens can reload. */
  syncedVersion: number;
  enqueue: (item: Parameters<typeof enqueueItem>[1]) => EnqueueResult;
  syncNow: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  remove: (id: string) => void;
  confirmWithPasskey: (id: string) => Promise<void>;
}

const OutboxContext = createContext<OutboxState | null>(null);

export function OutboxProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [items, setItems] = useState<OutboxItem[]>(() => loadOutbox(userId));
  const [syncedVersion, setSyncedVersion] = useState(0);

  const refresh = useCallback(() => {
    setItems((prev) => {
      const next = loadOutbox(userId);
      const before = prev.filter((i) => i.status === 'synced').length;
      const after = next.filter((i) => i.status === 'synced').length;
      if (after > before) setSyncedVersion((v) => v + 1);
      return next;
    });
  }, [userId]);

  const syncNow = useCallback(async () => {
    if (!isOnline()) return;
    await processOutbox(userId, send);
    refresh();
  }, [userId, refresh]);

  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent<{ userId: string }>).detail?.userId === userId) refresh();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === `fairshift.outbox.${userId}`) refresh();
    };
    const onOnline = () => void syncNow();
    window.addEventListener(OUTBOX_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', onOnline);
    // Send anything left from an earlier visit, once the app has rendered
    const first = window.setTimeout(() => void syncNow(), 0);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener(OUTBOX_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', onOnline);
    };
  }, [userId, refresh, syncNow]);

  const hasPending = items.some((i) => i.status === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => void syncNow(), 30_000);
    return () => window.clearInterval(timer);
  }, [hasPending, syncNow]);

  const value = useMemo<OutboxState>(
    () => ({
      items,
      unsentCount: items.filter(isUnsent).length,
      syncedVersion,
      enqueue: (item) => {
        const result = enqueueItem(userId, item);
        refresh();
        if (result.ok) void syncNow();
        return result;
      },
      syncNow,
      retry: async (id) => {
        retryItem(userId, id);
        refresh();
        await syncNow();
      },
      remove: (id) => {
        removeItem(userId, id);
        refresh();
      },
      confirmWithPasskey: async (id) => {
        await processOutbox(userId, send, { onlyId: id, withPasskey: true });
        refresh();
      },
    }),
    [items, syncedVersion, userId, refresh, syncNow],
  );

  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

/** The outbox for the signed-in worker, or null outside the worker app. */
export function useOutbox(): OutboxState | null {
  return useContext(OutboxContext);
}
