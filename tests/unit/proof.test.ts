import { describe, expect, it } from 'vitest';
import {
  canonicalizeJson,
  computeReceiptDigest,
  verifyReceiptDigest,
  calculateShiftEarnings,
  buildCorrectionDiff,
  type CanonicalReceiptData,
} from '../../src/domain/proof';
import { DomainError } from '../../src/domain/errors';

describe('FairShift Proof — Work Receipts & Integrity Verification', () => {
  const secret = 'test-secret-key-that-is-at-least-32-characters-long';

  const sampleReceipt: CanonicalReceiptData = {
    shiftId: 'shf_12345',
    workerId: 'usr_worker_1',
    orgId: 'org_const_1',
    version: 1,
    status: 'estimated',
    checkInAt: '2026-10-27T08:00:00.000Z',
    checkOutAt: '2026-10-27T17:00:00.000Z',
    durationMinutes: 540,
    rules: {
      scheduledDailyMinutes: 480,
      hourlyRateMinor: 10000, // ₹100.00 / hr
      overtimeMultiplierBp: 20000, // 2.0x
      currency: 'INR',
    },
    earnings: {
      durationMinutes: 540,
      regularMinutes: 480, // 8 hours
      overtimeMinutes: 60, // 1 hour
      basePayMinor: 80000, // ₹800.00
      overtimePayMinor: 20000, // 1h * ₹100 * 2.0 = ₹200.00
      grossPayMinor: 100000, // ₹1000.00
      estimatedNetPayMinor: 100000,
    },
    issuedAt: '2026-10-27T17:00:01.000Z',
  };

  it('canonicalizes JSON deterministically regardless of key order', () => {
    const objA = { z: 1, a: 'hello', m: { b: 2, a: 1 } };
    const objB = { a: 'hello', m: { a: 1, b: 2 }, z: 1 };

    expect(canonicalizeJson(objA)).toBe(canonicalizeJson(objB));
    expect(canonicalizeJson(objA)).toBe('{"a":"hello","m":{"a":1,"b":2},"z":1}');
  });

  it('computes deterministic cryptographic digest for receipt', () => {
    const digest1 = computeReceiptDigest(secret, sampleReceipt);
    const digest2 = computeReceiptDigest(secret, { ...sampleReceipt });

    expect(digest1).toHaveLength(64); // 256-bit hex
    expect(digest1).toBe(digest2);
    expect(verifyReceiptDigest(secret, sampleReceipt, digest1)).toBe(true);
  });

  it('detects tampering when any receipt attribute is altered', () => {
    const validDigest = computeReceiptDigest(secret, sampleReceipt);

    // Tampered gross pay
    const tamperedPay = {
      ...sampleReceipt,
      earnings: { ...sampleReceipt.earnings, grossPayMinor: 120000 },
    };
    expect(verifyReceiptDigest(secret, tamperedPay, validDigest)).toBe(false);

    // Tampered duration
    const tamperedDuration = {
      ...sampleReceipt,
      durationMinutes: 600,
    };
    expect(verifyReceiptDigest(secret, tamperedDuration, validDigest)).toBe(false);

    // Tampered check-in time
    const tamperedTime = {
      ...sampleReceipt,
      checkInAt: '2026-10-27T07:00:00.000Z',
    };
    expect(verifyReceiptDigest(secret, tamperedTime, validDigest)).toBe(false);

    // Wrong secret key fails verification
    expect(verifyReceiptDigest('different-secret-key', sampleReceipt, validDigest)).toBe(false);
  });

  it('calculates regular shift earnings correctly when within scheduled daily hours', () => {
    // 8-hour shift, 8-hour scheduled day, ₹95/hr, no prior shifts today
    const earnings = calculateShiftEarnings(
      { checkInAt: '2026-10-27T08:00:00.000Z', checkOutAt: '2026-10-27T16:00:00.000Z' },
      0,
      480,
      9500, // ₹95.00
      20000, // 2.0x
    );

    expect(earnings.durationMinutes).toBe(480);
    expect(earnings.regularMinutes).toBe(480);
    expect(earnings.overtimeMinutes).toBe(0);
    expect(earnings.basePayMinor).toBe(76000); // 8h * 95 = ₹760.00
    expect(earnings.overtimePayMinor).toBe(0);
    expect(earnings.grossPayMinor).toBe(76000);
  });

  it('calculates overtime correctly when single shift exceeds daily scheduled hours', () => {
    // 9.5-hour shift (570 min), 8-hour scheduled day (480 min), ₹120/hr, 1.5x OT multiplier (15000 bp)
    const earnings = calculateShiftEarnings(
      { checkInAt: '2026-10-27T08:00:00.000Z', checkOutAt: '2026-10-27T17:30:00.000Z' },
      0,
      480,
      12000, // ₹120.00
      15000, // 1.5x
    );

    expect(earnings.durationMinutes).toBe(570);
    expect(earnings.regularMinutes).toBe(480);
    expect(earnings.overtimeMinutes).toBe(90); // 1.5 hours
    expect(earnings.basePayMinor).toBe(96000); // 8h * 120 = ₹960.00
    expect(earnings.overtimePayMinor).toBe(27000); // 1.5h * 120 * 1.5 = ₹270.00
    expect(earnings.grossPayMinor).toBe(123000); // ₹1,230.00
  });

  it('accounts for prior worked minutes on the same calendar day for overtime threshold', () => {
    // Worker already completed 5 hours (300 min) earlier today.
    // Scheduled is 8 hours (480 min), so only 3 hours (180 min) of regular quota remain.
    // This second shift is 5 hours (300 min) long.
    const earnings = calculateShiftEarnings(
      { checkInAt: '2026-10-27T14:00:00.000Z', checkOutAt: '2026-10-27T19:00:00.000Z' },
      300, // prior 5h
      480, // daily 8h
      10000, // ₹100.00
      20000, // 2.0x
    );

    expect(earnings.durationMinutes).toBe(300);
    expect(earnings.regularMinutes).toBe(180); // 3h regular
    expect(earnings.overtimeMinutes).toBe(120); // 2h overtime
    expect(earnings.basePayMinor).toBe(30000); // 3h * 100 = ₹300.00
    expect(earnings.overtimePayMinor).toBe(40000); // 2h * 100 * 2.0 = ₹400.00
    expect(earnings.grossPayMinor).toBe(70000); // ₹700.00
  });

  it('rejects earnings calculation for invalid shift times', () => {
    expect(() => calculateShiftEarnings({ checkInAt: '2026-10-27T17:00:00.000Z', checkOutAt: '2026-10-27T08:00:00.000Z' }, 0, 480, 10000, 20000)).toThrow(
      DomainError,
    );
  });

  it('builds structured correction diff comparing versions accurately', () => {
    const correctedEarnings = {
      durationMinutes: 570,
      regularMinutes: 480,
      overtimeMinutes: 90,
      basePayMinor: 80000,
      overtimePayMinor: 30000,
      grossPayMinor: 110000,
      estimatedNetPayMinor: 110000,
    };

    const diff = buildCorrectionDiff(
      sampleReceipt,
      {
        checkInAt: sampleReceipt.checkInAt,
        checkOutAt: '2026-10-27T17:30:00.000Z',
        durationMinutes: 570,
        earnings: correctedEarnings,
      },
      {
        correctedAt: '2026-10-27T18:00:00.000Z',
        correctedBy: 'Priya Raman (Site manager)',
        reason: 'Worker remained 30 minutes overtime to finish concrete pour; confirmed with supervisor.',
      },
    );

    expect(diff.previousVersion).toBe(1);
    expect(diff.reason).toContain('concrete pour');
    expect(diff.changes.checkOutAt).toEqual({
      before: '2026-10-27T17:00:00.000Z',
      after: '2026-10-27T17:30:00.000Z',
    });
    expect(diff.changes.durationMinutes).toEqual({ before: 540, after: 570 });
    expect(diff.changes.overtimeMinutes).toEqual({ before: 60, after: 90 });
    expect(diff.changes.grossPayMinor).toEqual({
      before: 100000,
      after: 110000,
      deltaMinor: 10000, // +₹100.00
    });
  });
});
