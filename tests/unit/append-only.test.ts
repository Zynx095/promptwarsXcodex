import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/db';
import { seedIfEmpty } from '../../src/server/db/seed';
import { generateCheckpointForOrg } from '../../src/server/services/checkpoints';
import type { AppContext } from '../../src/server/context';

function setupCtx(): AppContext {
  const ctx: AppContext = {
    db: openDb(':memory:'),
    config: {
      port: 0,
      production: false,
      sessionSecret: 'test-session-secret-at-least-32-chars-long',
      receiptSigningSecret: 'test-receipt-secret-at-least-32-chars-long',
      receiptSigningKeys: { v1: 'test-receipt-secret-at-least-32-chars-long' },
      activeReceiptKeyId: 'v1',
      checkpointSigningSecret: 'test-checkpoint-secret-at-least-32-chars',
      checkpointSigningKeys: { chk_v1: 'test-checkpoint-secret-at-least-32-chars' },
      activeCheckpointKeyId: 'chk_v1',
      signalPseudonymSecret: 'test-signal-secret-at-least-32-chars-long',
      databasePath: ':memory:',
      demoMode: true,
      smsProvider: 'mock',
    },
    now: () => new Date('2026-10-30T10:00:00.000Z'),
  };
  seedIfEmpty(ctx);
  return ctx;
}

describe('Append-only history tables', () => {
  it('rejects updates and deletes of audit and report status events', () => {
    const { db } = setupCtx();
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_events')!.n).toBeGreaterThan(0);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM report_events')!.n).toBeGreaterThan(0);

    expect(() => db.run(`UPDATE audit_events SET reason = 'rewritten'`)).toThrow(/append-only/);
    expect(() => db.run(`DELETE FROM audit_events`)).toThrow(/append-only/);
    expect(() => db.run(`UPDATE report_events SET note = 'rewritten'`)).toThrow(/append-only/);
    expect(() => db.run(`DELETE FROM report_events`)).toThrow(/append-only/);
  });

  it('rejects edits to signed checkpoints and their entries while still allowing new checkpoints', () => {
    const ctx = setupCtx();
    const checkpoint = generateCheckpointForOrg(ctx, 'org_demo_construction');
    expect(checkpoint).not.toBeNull();

    expect(() => ctx.db.run(`UPDATE receipt_checkpoints SET merkle_root = @r`, { r: '0'.repeat(64) })).toThrow(/append-only/);
    expect(() => ctx.db.run(`DELETE FROM receipt_checkpoints`)).toThrow(/append-only/);
    expect(() => ctx.db.run(`UPDATE receipt_checkpoint_entries SET leaf_index = leaf_index + 1`)).toThrow(/append-only/);
    expect(() => ctx.db.run(`DELETE FROM receipt_checkpoint_entries`)).toThrow(/append-only/);
  });
});
