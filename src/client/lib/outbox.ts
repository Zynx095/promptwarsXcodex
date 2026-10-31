// The offline outbox: check-ins, check-outs and safety reports a worker made without a connection,
// kept on this phone (per signed-in worker) until the server confirms them. Nothing in here is
// treated as recorded: an item is "synced" only after the server answered with the stored record.
//
// Safeguards
// - One unsent attendance action at a time, and reports carry a random clientRequestId that the
//   server uses to store a retried report once, so retries never create duplicates.
// - The phone's clock is sent as `queuedAt` for review only; the server records its own time.
// - Expired sign-in and passkey checks stop at "needs action" and wait for the person.
// - Only the worker's own drafts are kept here; no tokens, passkeys or other people's data.
import type { ReportCreateInput } from '../../shared/schemas';

export type OutboxKind = 'check-in' | 'check-out' | 'report';
/**
 * pending: waiting to send. syncing: being sent now. synced: the server confirmed it.
 * needs_action: the person must sign in again or confirm with their passkey. conflict: the server
 * already had a different state (e.g. already checked in), nothing was added. failed: refused.
 */
export type OutboxStatus = 'pending' | 'syncing' | 'synced' | 'needs_action' | 'conflict' | 'failed';
export type OutboxAction = 'signin' | 'passkey';

export type ReportPayload = Omit<ReportCreateInput, 'clientRequestId' | 'inspectionChecks' | 'confidential'> & {
  clientRequestId: string;
  confidential: boolean;
  inspectionChecks: string[];
};

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  /** When the phone saved it (its own clock; informational only). */
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  action?: OutboxAction;
  error?: string;
  errorCode?: string;
  syncedAt?: string;
  /** ID of the record the server created (shift or report). */
  resultId?: string;
  siteCode?: string;
  report?: ReportPayload;
}

export interface SendError {
  status: number;
  code: string;
  message: string;
}

export type Sender = (item: OutboxItem, opts: { withPasskey: boolean }) => Promise<{ id: string }>;

const PREFIX = 'fairshift.outbox.';
const KEEP_DONE_MS = 24 * 60 * 60 * 1000;
const MAX_DONE = 20;
const UNSENT: OutboxStatus[] = ['pending', 'syncing', 'needs_action', 'failed'];
export const OUTBOX_EVENT = 'fairshift:outbox';

const key = (userId: string) => `${PREFIX}${userId}`;
/** Workers whose outbox this page is sending right now. */
const running = new Set<string>();

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 from getRandomValues for older browsers
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function isUnsent(item: OutboxItem): boolean {
  return UNSENT.includes(item.status);
}

/** Drops confirmed items older than a day (and keeps at most MAX_DONE of them). */
function prune(items: OutboxItem[], now: number): OutboxItem[] {
  const unsent = items.filter(isUnsent);
  const done = items
    .filter((i) => !isUnsent(i) && now - Date.parse(i.syncedAt ?? i.createdAt) < KEEP_DONE_MS)
    .sort((a, b) => (b.syncedAt ?? b.createdAt).localeCompare(a.syncedAt ?? a.createdAt))
    .slice(0, MAX_DONE);
  return [...unsent, ...done].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function loadOutbox(userId: string, now = Date.now()): OutboxItem[] {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return [];
    const items = JSON.parse(raw) as OutboxItem[];
    if (!Array.isArray(items)) return [];
    // An item left "syncing" by a closed tab was never confirmed: send it again (safely, see above)
    const sending = running.has(userId);
    return prune(
      items.map((i) => (i.status === 'syncing' && !sending ? { ...i, status: 'pending' as const } : i)),
      now,
    );
  } catch {
    return [];
  }
}

export function saveOutbox(userId: string, items: OutboxItem[]): void {
  try {
    if (items.length === 0) localStorage.removeItem(key(userId));
    else localStorage.setItem(key(userId), JSON.stringify(items));
  } catch {
    /* storage full or unavailable: the in-memory list still shows the state */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OUTBOX_EVENT, { detail: { userId } }));
}

export function clearOutbox(userId: string): void {
  saveOutbox(userId, []);
}

export type EnqueueResult = { ok: true; item: OutboxItem } | { ok: false; reason: 'duplicate' };

export function enqueue(userId: string, item: Omit<OutboxItem, 'id' | 'status' | 'attempts' | 'createdAt'> & { createdAt?: string }): EnqueueResult {
  const items = loadOutbox(userId);
  if (item.kind !== 'report' && items.some((i) => i.kind !== 'report' && isUnsent(i))) return { ok: false, reason: 'duplicate' };
  if (item.kind === 'report' && items.some((i) => i.report?.clientRequestId === item.report?.clientRequestId)) return { ok: false, reason: 'duplicate' };
  const created: OutboxItem = { ...item, id: newId(), status: 'pending', attempts: 0, createdAt: item.createdAt ?? new Date().toISOString() };
  saveOutbox(userId, [...items, created]);
  return { ok: true, item: created };
}

function update(userId: string, id: string, patch: Partial<OutboxItem>): OutboxItem[] {
  const items = loadOutbox(userId).map((i) => (i.id === id ? { ...i, ...patch } : i));
  saveOutbox(userId, items);
  return items;
}

export function retryItem(userId: string, id: string): void {
  update(userId, id, { status: 'pending', action: undefined, error: undefined, errorCode: undefined });
}

export function removeItem(userId: string, id: string): void {
  saveOutbox(
    userId,
    loadOutbox(userId).filter((i) => i.id !== id),
  );
}

/** Decides what a failed send means for the item. */
export function classifyFailure(err: SendError): Pick<OutboxItem, 'status' | 'action' | 'error' | 'errorCode'> {
  if (err.status === 0) return { status: 'pending', error: err.message, errorCode: err.code };
  if (err.status === 401) return { status: 'needs_action', action: 'signin', error: err.message, errorCode: err.code };
  if (err.code === 'PASSKEY_REQUIRED' || err.code === 'PASSKEY_FAILED' || err.code === 'PASSKEY_CANCELLED') {
    return { status: 'needs_action', action: 'passkey', error: err.message, errorCode: err.code };
  }
  if (err.code === 'ALREADY_ON_SHIFT' || err.code === 'NOT_ON_SHIFT') return { status: 'conflict', error: err.message, errorCode: err.code };
  // Refused (expired site code, validation) or a server error: kept, and the person can retry or remove it
  return { status: 'failed', error: err.message, errorCode: err.code };
}

/**
 * Sends pending items in the order they were made, one at a time. Stops at the first network
 * failure (still offline). `onlyId` sends one item, e.g. after the person confirmed with a passkey.
 */
export async function processOutbox(userId: string, send: Sender, opts: { onlyId?: string; withPasskey?: boolean } = {}): Promise<OutboxItem[]> {
  if (running.has(userId)) return loadOutbox(userId);
  running.add(userId);
  try {
    for (const item of loadOutbox(userId)) {
      if (opts.onlyId ? item.id !== opts.onlyId : item.status !== 'pending') continue;
      if (opts.onlyId && !['pending', 'needs_action', 'failed'].includes(item.status)) continue;
      update(userId, item.id, { status: 'syncing', attempts: item.attempts + 1 });
      try {
        const result = await send(item, { withPasskey: Boolean(opts.withPasskey) });
        update(userId, item.id, {
          status: 'synced',
          resultId: result.id,
          syncedAt: new Date().toISOString(),
          error: undefined,
          errorCode: undefined,
          action: undefined,
        });
      } catch (e) {
        const err = toSendError(e);
        update(userId, item.id, classifyFailure(err));
        if (err.status === 0) break;
      }
    }
  } finally {
    running.delete(userId);
  }
  return loadOutbox(userId);
}

export function toSendError(e: unknown): SendError {
  if (e && typeof e === 'object' && 'status' in e && 'code' in e) {
    const x = e as { status: number; code: string; message?: string };
    return { status: x.status, code: x.code, message: x.message ?? 'Request failed.' };
  }
  return { status: 0, code: 'NETWORK', message: e instanceof Error ? e.message : 'Could not reach the server.' };
}

/** A report form draft, saved as it is typed (per worker, on this phone only). */
export interface ReportDraft {
  category: string;
  severity: string;
  title: string;
  location: string;
  description: string;
  identity: 'named' | 'confidential';
  checks: string[];
  siteId: string;
  savedAt: string;
}

const draftKey = (userId: string) => `fairshift.reportDraft.${userId}`;

export function loadReportDraft(userId: string): ReportDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    return raw ? (JSON.parse(raw) as ReportDraft) : null;
  } catch {
    return null;
  }
}

export function saveReportDraft(userId: string, draft: ReportDraft | null): void {
  try {
    if (draft) localStorage.setItem(draftKey(userId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(userId));
  } catch {
    /* storage unavailable */
  }
}

/** Removes everything this worker left on the phone (used at sign-out). */
export function clearLocalWorkerData(userId: string): void {
  clearOutbox(userId);
  saveReportDraft(userId, null);
}
