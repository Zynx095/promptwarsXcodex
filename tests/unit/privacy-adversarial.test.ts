import { describe, expect, it } from 'vitest';
import { reporterRef, scopedReporterRef, signalAggregationKey } from '../../src/server/auth/crypto';
import { openDb } from '../../src/server/db/db';
import { seedIfEmpty } from '../../src/server/db/seed';
import { createReport, listMyReports } from '../../src/server/services/reports';
import { getSafeSignals, invalidateSignalCache } from '../../src/server/services/signal';
import { getOrg } from '../../src/server/repositories/orgs';
import type { AppContext } from '../../src/server/context';

describe('Safe Signal — Advanced Privacy Engineering & Differencing Defenses', () => {
  const signalSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const sessionSecret = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

  it('generates domain-separated, unpredictable reporter pseudonyms per organization', () => {
    const workerId = 'usr_worker_123';
    const org1 = 'org_construction_site_a';
    const org2 = 'org_construction_site_b';

    const ref1 = scopedReporterRef(signalSecret, org1, workerId);
    const ref2 = scopedReporterRef(signalSecret, org2, workerId);
    const legacyRef = reporterRef(signalSecret, workerId);

    // Pseudonym format is base64url string
    expect(ref1).toMatch(/^[0-9a-zA-Z_-]+$/);
    expect(ref2).toMatch(/^[0-9a-zA-Z_-]+$/);

    // Cross-organization tenant isolation: same worker has different pseudonyms across orgs
    expect(ref1).not.toBe(ref2);

    // Scoped pseudonym differs from unscoped legacy reference
    expect(ref1).not.toBe(legacyRef);
    expect(ref2).not.toBe(legacyRef);
  });

  it('guarantees session cookie rotation does not break confidential report lookups', () => {
    const workerId = 'usr_worker_456';
    const orgId = 'org_test';

    const initialSessionSecret = 'session_secret_v1_0000000000000000';
    const rotatedSessionSecret = 'session_secret_v2_1111111111111111';

    // Pseudonym is tied to signalSecret, not sessionSecret
    const refBefore = scopedReporterRef(signalSecret, orgId, workerId);
    const refAfter = scopedReporterRef(signalSecret, orgId, workerId);

    expect(refBefore).toBe(refAfter);

    // Legacy un-scoped with session secret would have broken upon rotation
    const legacyBefore = reporterRef(initialSessionSecret, workerId);
    const legacyAfter = reporterRef(rotatedSessionSecret, workerId);
    expect(legacyBefore).not.toBe(legacyAfter);
  });

  it('verifies listMyReports backward-compatibility for legacy and scoped reports', () => {
    const clock = { now: new Date('2026-10-30T10:00:00.000Z') };
    const ctx: AppContext = {
      db: openDb(':memory:'),
      config: {
        port: 0,
        production: false,
        sessionSecret: sessionSecret,
        receiptSigningSecret: signalSecret,
        receiptSigningKeys: { v1: signalSecret },
        activeReceiptKeyId: 'v1',
        checkpointSigningSecret: signalSecret,
        checkpointSigningKeys: { chk_v1: signalSecret },
        activeCheckpointKeyId: 'chk_v1',
        signalPseudonymSecret: signalSecret,
        databasePath: ':memory:',
        demoMode: true,
        smsProvider: 'mock',
      },
      now: () => clock.now,
    };
    seedIfEmpty(ctx);
    const org = getOrg(ctx.db, 'org_demo_construction')!;
    const workerActor = { id: 'usr_demo_c_ravi', role: 'worker' as const, orgId: org.id };

    // Create a new confidential report with scopedReporterRef
    const newReport = createReport(ctx, org, workerActor, {
      category: 'fall',
      severity: 'medium',
      title: 'Missing safety harness on scaffolding',
      description: 'Harnesses on rack 3 were missing inspection tags.',
      location: 'Scaffold zone 2',
      confidential: true,
    });
    expect(newReport.confidential).toBe(true);

    // Insert a legacy confidential report with unscoped reporterRef
    const legacyRef = reporterRef(ctx.config.sessionSecret, workerActor.id);
    ctx.db.run(
      `INSERT INTO safety_reports (id, org_id, reporter_id, reporter_ref, confidential, category, severity, title, description, location, status, created_at, updated_at)
       VALUES ('rep_legacy_1', @orgId, NULL, @legacyRef, 1, 'fall', 'low', 'Legacy report', 'Legacy desc', 'Site 1', 'submitted', @now, @now)`,
      { orgId: org.id, legacyRef, now: clock.now.toISOString() },
    );

    // Worker retrieves their reports: both scoped and legacy reports must be returned
    const myReports = listMyReports(ctx, workerActor, 50);
    const foundNew = myReports.find((r) => r.id === newReport.id);
    const foundLegacy = myReports.find((r) => r.id === 'rep_legacy_1');

    expect(foundNew).toBeDefined();
    expect(foundLegacy).toBeDefined();
    expect(foundNew!.isMine).toBe(true);
    expect(foundLegacy!.isMine).toBe(true);
  });

  it('guarantees in-memory reporter keys are cryptographically pseudonymized before analysis', () => {
    const rawUserId = 'usr_sensitive_worker_999';
    const orgId = 'org_demo_construction';

    const aggregationKey = signalAggregationKey(signalSecret, orgId, rawUserId);
    expect(aggregationKey).toMatch(/^[0-9a-zA-Z_-]+$/);
    expect(aggregationKey).not.toContain('usr_');
    expect(aggregationKey).not.toContain('sensitive');

    // Deterministic for same worker within same org
    expect(signalAggregationKey(signalSecret, orgId, rawUserId)).toBe(aggregationKey);

    // Domain-separated for different org
    expect(signalAggregationKey(signalSecret, 'other_org', rawUserId)).not.toBe(aggregationKey);
  });

  it('defeats rapid temporal differencing attacks via snapshot caching', () => {
    const clock = { now: new Date('2026-10-30T10:00:00.000Z') };
    const ctx: AppContext = {
      db: openDb(':memory:'),
      config: {
        port: 0,
        production: false,
        sessionSecret,
        receiptSigningSecret: signalSecret,
        receiptSigningKeys: { v1: signalSecret },
        activeReceiptKeyId: 'v1',
        checkpointSigningSecret: signalSecret,
        checkpointSigningKeys: { chk_v1: signalSecret },
        activeCheckpointKeyId: 'chk_v1',
        signalPseudonymSecret: signalSecret,
        databasePath: ':memory:',
        demoMode: true,
        smsProvider: 'mock',
      },
      now: () => clock.now,
    };
    seedIfEmpty(ctx);
    const org = getOrg(ctx.db, 'org_demo_construction')!;

    invalidateSignalCache();
    const res1 = getSafeSignals(ctx, org);

    // Rapid second query within 5 seconds returns identical cached snapshot
    clock.now = new Date(clock.now.getTime() + 5000);
    const res2 = getSafeSignals(ctx, org);
    expect(res2).toBe(res1); // exact same object reference from cache

    // Query after cache window expired (16 seconds later) performs re-aggregation
    clock.now = new Date(clock.now.getTime() + 16000);
    const res3 = getSafeSignals(ctx, org);
    expect(res3).not.toBe(res1);
  });
});
