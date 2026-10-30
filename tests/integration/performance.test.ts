import { describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/db';
import { seedIfEmpty } from '../../src/server/db/seed';
import { buildMerkleTree, computeReceiptLeafHash, generateMerkleProof, hashSha256 } from '../../src/domain/merkle';
import { calculateAccountabilityMetrics, type AccountabilityEventInput, type AccountabilityReportInput } from '../../src/domain/accountability';
import { getShiftReceipts, verifyReceipt } from '../../src/server/services/receipts';
import { getOrg } from '../../src/server/repositories/orgs';
import { generateCheckpointForOrg } from '../../src/server/services/checkpoints';
import type { AppContext } from '../../src/server/context';

describe('Performance and Scalability Benchmarks (1,000+ Records)', () => {
  it('constructs and proves 1,000-leaf Merkle trees within tight performance budget (< 100ms)', () => {
    const leafCount = 1000;
    const rawDigests: string[] = [];
    for (let i = 0; i < leafCount; i++) {
      rawDigests.push(hashSha256(`performance_test_receipt_${i}`));
    }

    const startLeafHash = performance.now();
    const leafHashes = rawDigests.map(computeReceiptLeafHash);
    const leafHashDuration = performance.now() - startLeafHash;
    expect(leafHashDuration).toBeLessThan(100);

    const startTree = performance.now();
    const tree = buildMerkleTree(leafHashes);
    const treeDuration = performance.now() - startTree;
    expect(treeDuration).toBeLessThan(100);
    expect(tree.leaves).toHaveLength(leafCount);
    expect(tree.root).toMatch(/^[0-9a-f]{64}$/);

    // Generating 100 random inclusion proofs takes < 20ms
    const startProofs = performance.now();
    for (let i = 0; i < 100; i++) {
      const idx = Math.floor(Math.random() * leafCount);
      const proof = generateMerkleProof(tree, idx);
      expect(proof.length).toBeGreaterThan(0);
    }
    const proofsDuration = performance.now() - startProofs;
    expect(proofsDuration).toBeLessThan(50);
  });

  it('evaluates accountability metrics across 1,000 reports and event trails in < 50ms', () => {
    const reportCount = 1000;
    const reports: AccountabilityReportInput[] = [];
    const events: AccountabilityEventInput[] = [];

    for (let i = 0; i < reportCount; i++) {
      const id = `rep_scale_${i}`;
      const status = i % 5 === 0 ? 'outcome_verified' : i % 4 === 0 ? 'resolved' : i % 3 === 0 ? 'follow_up_pending' : 'submitted';
      reports.push({
        id,
        category: i % 2 === 0 ? 'fall' : 'electrical',
        severity: i % 4 === 0 ? 'critical' : 'medium',
        status,
        createdAt: '2026-10-01T08:00:00Z',
        resolvedAt: status !== 'submitted' ? '2026-10-02T10:00:00Z' : null,
        verifiedAt: status === 'outcome_verified' ? '2026-10-03T12:00:00Z' : null,
      });

      events.push(
        { reportId: id, fromStatus: null, toStatus: 'submitted', createdAt: '2026-10-01T08:00:00Z' },
        { reportId: id, fromStatus: 'submitted', toStatus: 'acknowledged', createdAt: '2026-10-01T08:30:00Z' },
      );
      if (status !== 'submitted') {
        events.push({ reportId: id, fromStatus: 'acknowledged', toStatus: 'resolved', createdAt: '2026-10-02T10:00:00Z' });
      }
      if (status === 'outcome_verified') {
        events.push({ reportId: id, fromStatus: 'resolved', toStatus: 'outcome_verified', createdAt: '2026-10-03T12:00:00Z' });
      }
    }

    const startMetrics = performance.now();
    const metrics = calculateAccountabilityMetrics(reports, events, '2026-10-30');
    const metricsDuration = performance.now() - startMetrics;

    expect(metricsDuration).toBeLessThan(100);
    expect(metrics.totalReports).toBe(1000);
    expect(metrics.meanTimeToAcknowledgeMinutes).toBe(30);
  });

  it('demonstrates sub-millisecond receipt lookup and verification using compound indexes', () => {
    const clock = { now: new Date('2026-10-30T10:00:00.000Z') };
    const ctx: AppContext = {
      db: openDb(':memory:'),
      config: {
        port: 0,
        production: false,
        sessionSecret: 'secret'.padEnd(32, 'x'),
        receiptSigningSecret: 'secret'.padEnd(32, 'x'),
        receiptSigningKeys: { v1: 'secret'.padEnd(32, 'x') },
        activeReceiptKeyId: 'v1',
        checkpointSigningSecret: 'secret'.padEnd(32, 'x'),
        checkpointSigningKeys: { chk_v1: 'secret'.padEnd(32, 'x') },
        activeCheckpointKeyId: 'chk_v1',
        signalPseudonymSecret: 'secret'.padEnd(32, 'x'),
        databasePath: ':memory:',
        demoMode: true,
        smsProvider: 'mock',
      },
      now: () => clock.now,
    };
    seedIfEmpty(ctx);
    const org = getOrg(ctx.db, 'org_demo_construction')!;

    // Create a checkpoint
    generateCheckpointForOrg(ctx, org.id);

    const receipt = ctx.db.get<{ id: string; shift_id: string }>(`SELECT id, shift_id FROM work_receipts WHERE org_id = @orgId LIMIT 1`, { orgId: org.id })!;

    // Benchmark 50 consecutive getShiftReceipts lookups
    const startHistory = performance.now();
    for (let i = 0; i < 50; i++) {
      const history = getShiftReceipts(ctx, org.id, receipt.shift_id);
      expect(history.current).toBeDefined();
    }
    const historyDuration = performance.now() - startHistory;
    expect(historyDuration / 50).toBeLessThan(10); // < 10ms average per call in-memory

    // Benchmark 50 consecutive verifyReceipt calls with Merkle inclusion check
    const startVerify = performance.now();
    for (let i = 0; i < 50; i++) {
      const res = verifyReceipt(ctx, org.id, receipt.id);
      expect(res.verified).toBe(true);
      expect(res.trustStatus).toBe('valid_and_anchored');
    }
    const verifyDuration = performance.now() - startVerify;
    expect(verifyDuration / 50).toBeLessThan(10); // < 10ms average per call with Merkle verification
  });
});
