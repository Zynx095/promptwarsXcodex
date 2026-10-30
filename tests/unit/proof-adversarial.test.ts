import { describe, expect, it } from 'vitest';
import { computeReceiptDigest, verifyReceiptDigest, buildCorrectionDiff, type CanonicalReceiptData } from '../../src/domain/proof';
import { DomainError } from '../../src/domain/errors';
import { openDb } from '../../src/server/db/db';
import { seedIfEmpty } from '../../src/server/db/seed';
import { getOrg } from '../../src/server/repositories/orgs';
import { listWorkerShifts } from '../../src/server/repositories/shifts';
import { issuePayslip } from '../../src/server/services/payslips';
import { correctShift } from '../../src/server/services/attendance';
import { generateReceiptForShift, getSecretForKey, isShiftInFinalizedPeriod, getShiftReceipts, verifyReceipt } from '../../src/server/services/receipts';
import type { AppContext } from '../../src/server/context';

describe('FairShift Proof — Adversarial Cryptographic & Version-Chain Audit', () => {
  const secret = 'v1-adversarial-test-signing-secret-key-32b';
  const rotatedSecret = 'v2-adversarial-test-signing-secret-key-32b';

  const baseReceipt: CanonicalReceiptData = {
    shiftId: 'shf_adv_001',
    workerId: 'usr_adv_worker_1',
    orgId: 'org_adv_tenant_a',
    version: 1,
    keyId: 'v1',
    status: 'estimated',
    checkInAt: '2026-10-27T08:00:00.000Z',
    checkOutAt: '2026-10-27T17:00:00.000Z',
    durationMinutes: 540,
    rules: {
      scheduledDailyMinutes: 480,
      hourlyRateMinor: 10000,
      overtimeMultiplierBp: 20000,
      currency: 'INR',
    },
    earnings: {
      durationMinutes: 540,
      regularMinutes: 480,
      overtimeMinutes: 60,
      basePayMinor: 80000,
      overtimePayMinor: 20000,
      grossPayMinor: 100000,
      estimatedNetPayMinor: 100000,
    },
    issuedAt: '2026-10-27T17:00:05.000Z',
  };

  const validDigest = computeReceiptDigest(secret, baseReceipt);

  it('validates authentic receipt with correct key', () => {
    expect(verifyReceiptDigest(secret, baseReceipt, validDigest)).toBe(true);
  });

  describe('Adversarial Vector 1: Comprehensive Single-Field Tampering', () => {
    const fieldsToTamper: Array<{ name: string; mutate: (r: CanonicalReceiptData) => CanonicalReceiptData }> = [
      { name: 'shiftId', mutate: (r) => ({ ...r, shiftId: 'shf_adv_002' }) },
      { name: 'workerId', mutate: (r) => ({ ...r, workerId: 'usr_adv_worker_2' }) },
      { name: 'orgId', mutate: (r) => ({ ...r, orgId: 'org_adv_tenant_b' }) },
      { name: 'version', mutate: (r) => ({ ...r, version: 2 }) },
      { name: 'keyId', mutate: (r) => ({ ...r, keyId: 'v2' }) },
      { name: 'status', mutate: (r) => ({ ...r, status: 'finalized' }) },
      { name: 'checkInAt (1 second difference)', mutate: (r) => ({ ...r, checkInAt: '2026-10-27T08:00:01.000Z' }) },
      { name: 'checkOutAt (1 second difference)', mutate: (r) => ({ ...r, checkOutAt: '2026-10-27T17:00:01.000Z' }) },
      { name: 'durationMinutes', mutate: (r) => ({ ...r, durationMinutes: 541 }) },
      { name: 'rules.scheduledDailyMinutes', mutate: (r) => ({ ...r, rules: { ...r.rules, scheduledDailyMinutes: 420 } }) },
      { name: 'rules.hourlyRateMinor', mutate: (r) => ({ ...r, rules: { ...r.rules, hourlyRateMinor: 10001 } }) },
      { name: 'rules.overtimeMultiplierBp', mutate: (r) => ({ ...r, rules: { ...r.rules, overtimeMultiplierBp: 15000 } }) },
      { name: 'rules.currency', mutate: (r) => ({ ...r, rules: { ...r.rules, currency: 'USD' } }) },
      { name: 'earnings.regularMinutes', mutate: (r) => ({ ...r, earnings: { ...r.earnings, regularMinutes: 479 } }) },
      { name: 'earnings.overtimeMinutes', mutate: (r) => ({ ...r, earnings: { ...r.earnings, overtimeMinutes: 61 } }) },
      { name: 'earnings.basePayMinor', mutate: (r) => ({ ...r, earnings: { ...r.earnings, basePayMinor: 80001 } }) },
      { name: 'earnings.overtimePayMinor', mutate: (r) => ({ ...r, earnings: { ...r.earnings, overtimePayMinor: 20001 } }) },
      { name: 'earnings.grossPayMinor', mutate: (r) => ({ ...r, earnings: { ...r.earnings, grossPayMinor: 100001 } }) },
      { name: 'earnings.estimatedNetPayMinor', mutate: (r) => ({ ...r, earnings: { ...r.earnings, estimatedNetPayMinor: 99999 } }) },
      { name: 'issuedAt', mutate: (r) => ({ ...r, issuedAt: '2026-10-27T17:00:06.000Z' }) },
    ];

    for (const { name, mutate } of fieldsToTamper) {
      it(`fails verification when ${name} is modified`, () => {
        const tampered = mutate(baseReceipt);
        expect(verifyReceiptDigest(secret, tampered, validDigest)).toBe(false);
      });
    }
  });

  describe('Adversarial Vector 2: Subtle Zero-Sum Earnings Tampering', () => {
    it('detects overtime inflation even when gross pay matches', () => {
      // Attacker inflates overtime pay and lowers base pay so gross remains 100000
      const tampered: CanonicalReceiptData = {
        ...baseReceipt,
        earnings: {
          ...baseReceipt.earnings,
          basePayMinor: 70000,
          overtimePayMinor: 30000,
          grossPayMinor: 100000,
        },
      };
      expect(verifyReceiptDigest(secret, tampered, validDigest)).toBe(false);
    });

    it('detects regular vs overtime minutes swap even when total duration matches', () => {
      // 400 regular + 140 overtime = 540 total
      const tampered: CanonicalReceiptData = {
        ...baseReceipt,
        earnings: {
          ...baseReceipt.earnings,
          regularMinutes: 400,
          overtimeMinutes: 140,
        },
      };
      expect(verifyReceiptDigest(secret, tampered, validDigest)).toBe(false);
    });
  });

  describe('Adversarial Vector 3: Signature Mutation & Malformed Digests', () => {
    it('rejects empty signature without throwing', () => {
      expect(verifyReceiptDigest(secret, baseReceipt, '')).toBe(false);
    });

    it('rejects non-hex characters without throwing', () => {
      const nonHex = 'g'.repeat(64);
      expect(verifyReceiptDigest(secret, baseReceipt, nonHex)).toBe(false);
    });

    it('rejects signature with embedded spaces or punctuation', () => {
      const withSpace = ' ' + validDigest.slice(1);
      expect(verifyReceiptDigest(secret, baseReceipt, withSpace)).toBe(false);
    });

    it('rejects truncated signature (63 hex chars)', () => {
      expect(verifyReceiptDigest(secret, baseReceipt, validDigest.slice(0, 63))).toBe(false);
    });

    it('rejects padded signature (65 hex chars)', () => {
      expect(verifyReceiptDigest(secret, baseReceipt, validDigest + '0')).toBe(false);
    });

    it('verifies uppercase hex representation via canonical normalization', () => {
      const upperDigest = validDigest.toUpperCase();
      expect(verifyReceiptDigest(secret, baseReceipt, upperDigest)).toBe(true);
    });

    it('safely handles non-string digest types', () => {
      expect(verifyReceiptDigest(secret, baseReceipt, null as unknown as string)).toBe(false);
      expect(verifyReceiptDigest(secret, baseReceipt, undefined as unknown as string)).toBe(false);
      expect(verifyReceiptDigest(secret, baseReceipt, 12345 as unknown as string)).toBe(false);
    });
  });

  describe('Adversarial Vector 4: Unkeyed HMAC & Secret Validation', () => {
    it('refuses to compute digest with empty secret', () => {
      expect(() => computeReceiptDigest('', baseReceipt)).toThrowError(DomainError);
    });

    it('refuses to compute digest with whitespace-only secret', () => {
      expect(() => computeReceiptDigest('   ', baseReceipt)).toThrowError(DomainError);
    });

    it('refuses to compute digest with invalid object data', () => {
      expect(() => computeReceiptDigest(secret, null as unknown as CanonicalReceiptData)).toThrowError(DomainError);
    });

    it('returns false when verifying with empty secret', () => {
      expect(verifyReceiptDigest('', baseReceipt, validDigest)).toBe(false);
      expect(verifyReceiptDigest('   ', baseReceipt, validDigest)).toBe(false);
    });
  });

  describe('Adversarial Vector 5: Key Rotation & Multi-Key Support', () => {
    const config = {
      receiptSigningSecret: secret,
      receiptSigningKeys: {
        v1: secret,
        v2: rotatedSecret,
      },
      activeReceiptKeyId: 'v2',
    };

    const ctx = { config } as unknown as AppContext;

    it('retrieves the correct key for a given keyId', () => {
      expect(getSecretForKey(ctx, 'v1')).toBe(secret);
      expect(getSecretForKey(ctx, 'v2')).toBe(rotatedSecret);
      expect(getSecretForKey(ctx, 'unknown_key')).toBe(secret); // fallback
    });

    it('verifies receipt sealed with v1 key after active key is rotated to v2', () => {
      const v1Receipt: CanonicalReceiptData = { ...baseReceipt, keyId: 'v1' };
      const v1Digest = computeReceiptDigest(secret, v1Receipt);

      const v2Receipt: CanonicalReceiptData = { ...baseReceipt, keyId: 'v2', version: 2 };
      const v2Digest = computeReceiptDigest(rotatedSecret, v2Receipt);

      // Verify v1 with v1 key
      expect(verifyReceiptDigest(getSecretForKey(ctx, v1Receipt.keyId), v1Receipt, v1Digest)).toBe(true);

      // Verify v2 with v2 key
      expect(verifyReceiptDigest(getSecretForKey(ctx, v2Receipt.keyId), v2Receipt, v2Digest)).toBe(true);

      // v1 receipt fails if checked with v2 key
      expect(verifyReceiptDigest(getSecretForKey(ctx, 'v2'), v1Receipt, v1Digest)).toBe(false);
    });
  });

  describe('Adversarial Vector 6: Version-Chain Tampering & Diff Integrity', () => {
    const v1Data: CanonicalReceiptData = { ...baseReceipt, version: 1 };
    const diff = buildCorrectionDiff(
      v1Data,
      {
        checkInAt: '2026-10-27T08:30:00.000Z',
        checkOutAt: '2026-10-27T17:00:00.000Z',
        durationMinutes: 510,
        earnings: {
          durationMinutes: 510,
          regularMinutes: 480,
          overtimeMinutes: 30,
          basePayMinor: 80000,
          overtimePayMinor: 10000,
          grossPayMinor: 90000,
          estimatedNetPayMinor: 90000,
        },
      },
      {
        correctedAt: '2026-10-27T18:00:00.000Z',
        correctedBy: 'Admin User (usr_admin_1)',
        reason: 'Late arrival verified at site gate',
      },
    );

    const v2Data: CanonicalReceiptData = {
      ...baseReceipt,
      version: 2,
      checkInAt: '2026-10-27T08:30:00.000Z',
      durationMinutes: 510,
      earnings: {
        durationMinutes: 510,
        regularMinutes: 480,
        overtimeMinutes: 30,
        basePayMinor: 80000,
        overtimePayMinor: 10000,
        grossPayMinor: 90000,
        estimatedNetPayMinor: 90000,
      },
      correction: diff,
    };

    const v2Digest = computeReceiptDigest(secret, v2Data);

    it('verifies valid corrected v2 receipt with correction diff', () => {
      expect(verifyReceiptDigest(secret, v2Data, v2Digest)).toBe(true);
    });

    it('detects tampering in correction audit metadata', () => {
      const tamperedDiffReason: CanonicalReceiptData = {
        ...v2Data,
        correction: {
          ...v2Data.correction!,
          reason: 'Forged correction reason',
        },
      };
      expect(verifyReceiptDigest(secret, tamperedDiffReason, v2Digest)).toBe(false);

      const tamperedDiffActor: CanonicalReceiptData = {
        ...v2Data,
        correction: {
          ...v2Data.correction!,
          correctedBy: 'Imposter (usr_evil)',
        },
      };
      expect(verifyReceiptDigest(secret, tamperedDiffActor, v2Digest)).toBe(false);
    });

    it('detects tampering in correction diff recorded historical values', () => {
      const tamperedHistoricalBase: CanonicalReceiptData = {
        ...v2Data,
        correction: {
          ...v2Data.correction!,
          changes: {
            ...v2Data.correction!.changes,
            basePayMinor: { before: 99999, after: 80000 },
          },
        },
      };
      expect(verifyReceiptDigest(secret, tamperedHistoricalBase, v2Digest)).toBe(false);
    });
  });

  describe('Adversarial Vector 7: Post-Finalization Shift Mutation Lock', () => {
    function setupEnv() {
      const clock = { now: new Date('2026-10-27T10:00:00.000Z') };
      const ctx: AppContext = {
        db: openDb(':memory:'),
        config: {
          port: 0,
          production: false,
          sessionSecret: secret,
          receiptSigningSecret: secret,
          receiptSigningKeys: { v1: secret },
          activeReceiptKeyId: 'v1',
          checkpointSigningSecret: secret,
          checkpointSigningKeys: { chk_v1: secret },
          activeCheckpointKeyId: 'chk_v1',
          signalPseudonymSecret: secret,
          databasePath: ':memory:',
          demoMode: true,
          smsProvider: 'mock',
        },
        now: () => clock.now,
      };
      seedIfEmpty(ctx);
      const org = getOrg(ctx.db, 'org_demo_construction')!;
      return { ctx, org, clock };
    }

    it('locks shift from direct mutation once pay period is finalized', () => {
      const { ctx, org } = setupEnv();

      // Find an existing completed shift in org_demo_construction for Ravi from a past window
      const shifts = listWorkerShifts(ctx.db, 'usr_demo_c_ravi', '2026-10-12T00:00:00.000Z', '2026-10-20T23:59:59.000Z');
      const targetShift = shifts.find((s) => s.checkOutAt !== null)!;
      expect(targetShift).toBeDefined();

      // Seeded data already includes the initial v1 receipt for completed shifts
      const { current: initialReceipt } = getShiftReceipts(ctx, org.id, targetShift.id);
      expect(initialReceipt).toBeDefined();
      expect(initialReceipt?.version).toBe(1);

      // Verify that trying to insert a duplicate v1 receipt triggers a CONFLICT domain error
      expect(() => generateReceiptForShift(ctx, org, targetShift.id)).toThrowError(/already exists/);

      // Issue payslip covering the shift's period (2026-10-12 to 2026-10-20, which has no open shifts)
      issuePayslip(ctx, org, 'usr_demo_c_admin', targetShift.workerId, '2026-10-12', '2026-10-20');

      // Confirm isShiftInFinalizedPeriod is true
      expect(isShiftInFinalizedPeriod(ctx, org.id, targetShift.workerId, targetShift.checkInAt, org.timezone)).toBe(true);

      // Attempt standard correction without isPayrollAdjustment flag -> must throw FINALIZED_PERIOD_LOCKED
      expect(() =>
        correctShift(ctx, org, 'usr_demo_c_admin', targetShift.id, {
          checkInAt: targetShift.checkInAt,
          checkOutAt: new Date(Date.parse(targetShift.checkOutAt!) + 3600000).toISOString(),
          reason: 'Unauthorized post-finalization edit',
        }),
      ).toThrowError(/finalized pay period/);

      // Correction WITH isPayrollAdjustment: true succeeds
      const corrected = correctShift(ctx, org, 'usr_demo_c_admin', targetShift.id, {
        checkInAt: targetShift.checkInAt,
        checkOutAt: new Date(Date.parse(targetShift.checkOutAt!) + 3600000).toISOString(),
        reason: 'Legitimate retroactive payroll adjustment authorized by HR',
        isPayrollAdjustment: true,
      });

      expect(corrected).toBeDefined();

      // Verify the new receipt version is finalized and cryptographic digest is valid
      const { current, history } = getShiftReceipts(ctx, org.id, targetShift.id);
      expect(history.length).toBe(2);
      expect(current?.version).toBe(2);
      expect(current?.status).toBe('finalized');
      expect(current?.verified).toBe(true);

      // Verify receipt by ID verifies successfully
      const singleVerify = verifyReceipt(ctx, org.id, current!.id);
      expect(singleVerify.verified).toBe(true);
    });

    it('correctly recognizes shifts on period_end date as finalized', () => {
      const { ctx, org } = setupEnv();

      // Period: 2026-10-20 to 2026-10-25
      issuePayslip(ctx, org, 'usr_demo_c_admin', 'usr_demo_c_ravi', '2026-10-20', '2026-10-25');

      // A shift starting on 2026-10-25 at 10:00:00 IST (04:30:00 UTC) must be finalized
      const checkInIso = '2026-10-25T04:30:00.000Z';
      expect(isShiftInFinalizedPeriod(ctx, org.id, 'usr_demo_c_ravi', checkInIso, org.timezone)).toBe(true);

      // A shift on 2026-10-26 is NOT finalized
      const nextDayCheckInIso = '2026-10-26T04:30:00.000Z';
      expect(isShiftInFinalizedPeriod(ctx, org.id, 'usr_demo_c_ravi', nextDayCheckInIso, org.timezone)).toBe(false);
    });
  });
});
