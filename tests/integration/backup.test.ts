import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupDb, openDb, verifyDbIntegrity } from '../../src/server/db/db';
import { seedIfEmpty } from '../../src/server/db/seed';
import type { AppContext } from '../../src/server/context';

describe('Production Reliability — SQLite Backups, Integrity & Recovery', () => {
  const testDir = join(tmpdir(), `fairshift-backup-test-${Date.now()}`);

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('creates an atomic point-in-time backup snapshot and verifies integrity and restoration', () => {
    const liveDbPath = join(testDir, 'live.db');
    const backupDbPath = join(testDir, 'backup.db');

    let liveDb: ReturnType<typeof openDb> | undefined;
    let restoredDb: ReturnType<typeof openDb> | undefined;

    try {
      // 1. Initialize live database and seed demo records
      liveDb = openDb(liveDbPath);
      const clock = { now: new Date('2026-10-30T10:00:00.000Z') };
      const ctx: AppContext = {
        db: liveDb,
        config: {
          port: 0,
          production: true,
          sessionSecret: 'secret'.padEnd(32, 'x'),
          receiptSigningSecret: 'secret'.padEnd(32, 'x'),
          receiptSigningKeys: { v1: 'secret'.padEnd(32, 'x') },
          activeReceiptKeyId: 'v1',
          checkpointSigningSecret: 'secret'.padEnd(32, 'x'),
          checkpointSigningKeys: { chk_v1: 'secret'.padEnd(32, 'x') },
          activeCheckpointKeyId: 'chk_v1',
          signalPseudonymSecret: 'secret'.padEnd(32, 'x'),
          databasePath: liveDbPath,
          demoMode: true,
          smsProvider: 'mock',
        },
        now: () => clock.now,
      };
      seedIfEmpty(ctx);

      // Verify live DB integrity
      const liveIntegrity = verifyDbIntegrity(liveDb);
      expect(liveIntegrity.ok).toBe(true);
      expect(liveIntegrity.message).toBe('ok');

      // Capture counts from live database
      const orgCount = liveDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM organizations`)!.n;
      const userCount = liveDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users`)!.n;
      const shiftCount = liveDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts`)!.n;
      const reportCount = liveDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM safety_reports`)!.n;
      const receiptCount = liveDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM work_receipts`)!.n;

      expect(orgCount).toBeGreaterThan(0);
      expect(userCount).toBeGreaterThan(0);
      expect(shiftCount).toBeGreaterThan(0);

      // 2. Execute non-blocking VACUUM INTO backup
      backupDb(liveDb, backupDbPath);
      expect(existsSync(backupDbPath)).toBe(true);

      // 3. Open restored backup database independently
      restoredDb = openDb(backupDbPath);
      const backupIntegrity = verifyDbIntegrity(restoredDb);
      expect(backupIntegrity.ok).toBe(true);
      expect(backupIntegrity.message).toBe('ok');

      // 4. Verify identical record counts across all core entities
      expect(restoredDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM organizations`)!.n).toBe(orgCount);
      expect(restoredDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users`)!.n).toBe(userCount);
      expect(restoredDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts`)!.n).toBe(shiftCount);
      expect(restoredDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM safety_reports`)!.n).toBe(reportCount);
      expect(restoredDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM work_receipts`)!.n).toBe(receiptCount);

      // 5. Verify live database can continue writing without disruption
      liveDb.run(
        `INSERT INTO shifts (id, org_id, worker_id, check_in_at, check_out_at, source, created_at, updated_at)
         VALUES ('shf_post_backup', 'org_demo_construction', 'usr_demo_c_ravi', @now, @checkOut, 'app', @now, @now)`,
        { now: clock.now.toISOString(), checkOut: new Date(clock.now.getTime() + 3600000).toISOString() },
      );
      expect(liveDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts`)!.n).toBe(shiftCount + 1);

      // Backup snapshot remains unchanged (point-in-time isolation)
      expect(restoredDb.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts`)!.n).toBe(shiftCount);
    } finally {
      liveDb?.close();
      restoredDb?.close();
    }
  });
});
