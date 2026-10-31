// @vitest-environment happy-dom
// The offline outbox: what is queued, what is sent, what is never duplicated, and how each kind
// of failure is reported. Uses a fake sender, so nothing here depends on the network.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyFailure,
  clearLocalWorkerData,
  enqueue,
  isUnsent,
  loadOutbox,
  loadReportDraft,
  processOutbox,
  retryItem,
  saveOutbox,
  saveReportDraft,
  type OutboxItem,
  type Sender,
} from '../../src/client/lib/outbox';

const USER = 'worker-1';
const fail = (status: number, code: string, message = code) => Object.assign(new Error(message), { status, code });

function report(id = crypto.randomUUID()) {
  return {
    category: 'electrical',
    severity: 'high' as const,
    title: 'Loose cable',
    description: 'Exposed cable near the hoist.',
    location: 'Level 2',
    confidential: false,
    inspectionChecks: [],
    siteId: null,
    clientRequestId: id,
  };
}

beforeEach(() => localStorage.clear());

describe('offline outbox', () => {
  it('keeps one unsent attendance action at a time and never queues the same report twice', () => {
    expect(enqueue(USER, { kind: 'check-in' }).ok).toBe(true);
    expect(enqueue(USER, { kind: 'check-in' })).toEqual({ ok: false, reason: 'duplicate' });
    expect(enqueue(USER, { kind: 'check-out' })).toEqual({ ok: false, reason: 'duplicate' });
    const r = report();
    expect(enqueue(USER, { kind: 'report', report: r }).ok).toBe(true);
    expect(enqueue(USER, { kind: 'report', report: r })).toEqual({ ok: false, reason: 'duplicate' });
    expect(loadOutbox(USER)).toHaveLength(2);
    // Another worker on the same phone has a separate outbox
    expect(loadOutbox('worker-2')).toEqual([]);
  });

  it('sends in order and marks items recorded only after the server confirms them', async () => {
    enqueue(USER, { kind: 'check-in', createdAt: '2026-10-27T03:00:00.000Z' });
    enqueue(USER, { kind: 'report', report: report(), createdAt: '2026-10-27T03:05:00.000Z' });
    const sent: string[] = [];
    const send: Sender = async (item) => {
      // While being sent, the item is "syncing", not recorded
      expect(loadOutbox(USER).find((i) => i.id === item.id)!.status).toBe('syncing');
      sent.push(item.kind);
      return { id: `server-${item.kind}` };
    };
    const items = await processOutbox(USER, send);
    expect(sent).toEqual(['check-in', 'report']);
    expect(items.map((i) => [i.status, i.resultId])).toEqual([
      ['synced', 'server-check-in'],
      ['synced', 'server-report'],
    ]);
    expect(items.every((i) => !isUnsent(i))).toBe(true);
    // Nothing left to send: a second run sends nothing
    await processOutbox(USER, async () => {
      throw new Error('should not send');
    });
  });

  it('stops at a network failure and leaves the item waiting, to retry later', async () => {
    enqueue(USER, { kind: 'check-in' });
    enqueue(USER, { kind: 'report', report: report() });
    let calls = 0;
    const items = await processOutbox(USER, async () => {
      calls++;
      throw fail(0, 'NETWORK', 'Could not reach the server.');
    });
    expect(calls).toBe(1);
    expect(items.map((i) => i.status)).toEqual(['pending', 'pending']);
    expect(items[0]!.attempts).toBe(1);
    expect(items[0]!.error).toBe('Could not reach the server.');
  });

  it('turns expired sign-in and passkey challenges into "needs you", and duplicates into conflicts', () => {
    expect(classifyFailure({ status: 401, code: 'UNAUTHENTICATED', message: 'x' })).toMatchObject({ status: 'needs_action', action: 'signin' });
    expect(classifyFailure({ status: 403, code: 'PASSKEY_REQUIRED', message: 'x' })).toMatchObject({ status: 'needs_action', action: 'passkey' });
    expect(classifyFailure({ status: 403, code: 'PASSKEY_FAILED', message: 'challenge expired' })).toMatchObject({ status: 'needs_action', action: 'passkey' });
    expect(classifyFailure({ status: 409, code: 'ALREADY_ON_SHIFT', message: 'x' })).toMatchObject({ status: 'conflict' });
    expect(classifyFailure({ status: 409, code: 'NOT_ON_SHIFT', message: 'x' })).toMatchObject({ status: 'conflict' });
    expect(classifyFailure({ status: 422, code: 'INVALID_SITE_CODE', message: 'expired code' })).toMatchObject({ status: 'failed', error: 'expired code' });
    expect(classifyFailure({ status: 500, code: 'INTERNAL', message: 'x' })).toMatchObject({ status: 'failed' });
    expect(classifyFailure({ status: 0, code: 'NETWORK', message: 'x' })).toMatchObject({ status: 'pending' });
  });

  it('lets the person retry a failed item, and confirm a passkey-protected one on demand', async () => {
    const { item } = enqueue(USER, { kind: 'check-in' }) as { ok: true; item: OutboxItem };
    await processOutbox(USER, async () => {
      throw fail(403, 'PASSKEY_REQUIRED');
    });
    expect(loadOutbox(USER)[0]).toMatchObject({ status: 'needs_action', action: 'passkey' });
    // Automatic runs leave it alone: it needs the person
    await processOutbox(USER, async () => {
      throw new Error('must not auto-send');
    });
    let withPasskey = false;
    await processOutbox(
      USER,
      async (_i, opts) => {
        withPasskey = opts.withPasskey;
        return { id: 'shift-1' };
      },
      { onlyId: item.id, withPasskey: true },
    );
    expect(withPasskey).toBe(true);
    expect(loadOutbox(USER)[0]).toMatchObject({ status: 'synced', resultId: 'shift-1' });

    const second = enqueue(USER, { kind: 'check-out' }) as { ok: true; item: OutboxItem };
    await processOutbox(USER, async () => {
      throw fail(422, 'VALIDATION', 'Rejected');
    });
    expect(loadOutbox(USER).find((i) => i.id === second.item.id)).toMatchObject({ status: 'failed', error: 'Rejected' });
    retryItem(USER, second.item.id);
    expect(loadOutbox(USER).find((i) => i.id === second.item.id)).toMatchObject({ status: 'pending' });
  });

  it('never sends the same item twice at once', async () => {
    enqueue(USER, { kind: 'check-in' });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const send: Sender = async () => {
      calls++;
      await gate;
      return { id: 's' };
    };
    const a = processOutbox(USER, send);
    const b = processOutbox(USER, send);
    release();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
  });

  it('resends an item a closed tab left half-sent, and the server stores a retried report once', () => {
    const r = report();
    saveOutbox(USER, [{ id: 'a', kind: 'report', report: r, status: 'syncing', attempts: 1, createdAt: new Date().toISOString() }]);
    const [item] = loadOutbox(USER);
    expect(item!.status).toBe('pending');
    // The same clientRequestId goes with every attempt (see the server test for the single stored row)
    expect(item!.report!.clientRequestId).toBe(r.clientRequestId);
  });

  it('drops confirmed items after a day but keeps anything unsent', () => {
    const old = new Date(Date.now() - 2 * 86400000).toISOString();
    saveOutbox(USER, [
      { id: 'done', kind: 'check-in', status: 'synced', attempts: 1, createdAt: old, syncedAt: old },
      { id: 'waiting', kind: 'check-out', status: 'pending', attempts: 0, createdAt: old },
    ]);
    expect(loadOutbox(USER).map((i) => i.id)).toEqual(['waiting']);
  });

  it('keeps report drafts per worker and removes everything at sign-out', () => {
    saveReportDraft(USER, {
      category: 'fall',
      severity: 'high',
      title: 'Open edge',
      location: 'L3',
      description: '',
      identity: 'named',
      checks: [],
      siteId: '',
      savedAt: '',
    });
    expect(loadReportDraft(USER)?.title).toBe('Open edge');
    expect(loadReportDraft('worker-2')).toBeNull();
    enqueue(USER, { kind: 'check-in' });
    clearLocalWorkerData(USER);
    expect(loadReportDraft(USER)).toBeNull();
    expect(loadOutbox(USER)).toEqual([]);
  });

  it('stores no credentials: only the action, its time and the worker’s own report text', () => {
    enqueue(USER, { kind: 'check-in', siteCode: '123456' });
    const raw = localStorage.getItem(`fairshift.outbox.${USER}`)!;
    expect(raw).not.toMatch(/passkey|signature|clientDataJSON|cookie|session|token/i);
  });
});
