// FairShift Proof — Canonical serialization, cryptographic digests, and earnings calculations.
import { createHmac } from 'node:crypto';
import { safeEqual } from '../server/auth/crypto';
import { payForMinutes } from '../shared/money';
import { minutesBetween } from '../shared/time';
import { DomainError } from './errors';
import type { CanonicalReceiptData, ReceiptCalculationRule, ReceiptCorrectionDiff, ReceiptEarningsBreakdown } from '../shared/types';

export type { CanonicalReceiptData, ReceiptCalculationRule, ReceiptCorrectionDiff, ReceiptEarningsBreakdown };

/**
 * Deterministically serializes any JavaScript object or primitive into canonical JSON.
 * Keys are sorted recursively, guaranteeing byte-for-byte reproducibility regardless of key insertion order.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ':' + canonicalizeJson((obj as Record<string, unknown>)[k]));
  return '{' + entries.join(',') + '}';
}

/**
 * Computes a cryptographic HMAC-SHA256 digest of the canonical receipt data.
 */
export function computeReceiptDigest(secret: string, data: CanonicalReceiptData): string {
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    throw new DomainError('INVALID_SIGNING_SECRET', 'A valid non-empty signing secret is required to sign work receipts.');
  }
  if (!data || typeof data !== 'object') {
    throw new DomainError('INVALID_RECEIPT_DATA', 'Receipt data must be a valid object.');
  }
  const canonicalString = canonicalizeJson(data);
  return createHmac('sha256', secret).update(canonicalString).digest('hex');
}

/**
 * Verifies that the provided receipt data matches its stored cryptographic digest.
 * Safely guards against missing keys, malformed digests, non-hex strings, and parsing anomalies.
 */
export function verifyReceiptDigest(secret: string, data: CanonicalReceiptData, expectedDigest: string): boolean {
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) return false;
  if (!expectedDigest || typeof expectedDigest !== 'string') return false;
  // A valid SHA-256 hex digest must be exactly 64 hexadecimal characters
  if (!/^[0-9a-fA-F]{64}$/.test(expectedDigest)) return false;
  try {
    const computed = computeReceiptDigest(secret, data);
    return safeEqual(computed.toLowerCase(), expectedDigest.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Calculates earnings for a completed shift using organization pay rules and daily scheduled thresholds.
 * Takes into account worked minutes already accumulated on the same calendar day by completed prior shifts.
 */
export function calculateShiftEarnings(
  shift: { checkInAt: string; checkOutAt: string },
  priorWorkedMinutesOnDay: number,
  scheduledDailyMinutes: number,
  hourlyRateMinor: number,
  overtimeMultiplierBp: number,
): ReceiptEarningsBreakdown {
  if (!shift.checkOutAt) {
    throw new DomainError('INVALID_SHIFT_TIMES', 'Cannot calculate earnings for an open shift.');
  }

  const durationMinutes = minutesBetween(shift.checkInAt, shift.checkOutAt);
  if (durationMinutes < 0) {
    throw new DomainError('INVALID_SHIFT_TIMES', 'Check-out time must be after check-in time.');
  }

  // Determine how many minutes of this shift fall into regular vs overtime based on daily quota
  const remainingRegularQuota = Math.max(0, scheduledDailyMinutes - priorWorkedMinutesOnDay);
  const regularMinutes = Math.min(durationMinutes, remainingRegularQuota);
  const overtimeMinutes = Math.max(0, durationMinutes - regularMinutes);

  const basePayMinor = payForMinutes(regularMinutes, hourlyRateMinor);
  const overtimePayMinor = payForMinutes(overtimeMinutes, hourlyRateMinor, overtimeMultiplierBp);
  const grossPayMinor = basePayMinor + overtimePayMinor;

  // In shift receipts without period deduction reconciliations, estimated net equals gross before payslip
  const estimatedNetPayMinor = grossPayMinor;

  return {
    durationMinutes,
    regularMinutes,
    overtimeMinutes,
    basePayMinor,
    overtimePayMinor,
    grossPayMinor,
    estimatedNetPayMinor,
  };
}

/**
 * Computes a structured diff between a previous receipt version and a corrected receipt version.
 */
export function buildCorrectionDiff(
  prev: CanonicalReceiptData,
  curr: {
    checkInAt: string;
    checkOutAt: string;
    durationMinutes: number;
    rules?: ReceiptCalculationRule;
    earnings: ReceiptEarningsBreakdown;
  },
  meta: {
    correctedAt: string;
    correctedBy: string;
    reason: string;
  },
): ReceiptCorrectionDiff {
  const changes: ReceiptCorrectionDiff['changes'] = {};

  if (prev.checkInAt !== curr.checkInAt) {
    changes.checkInAt = { before: prev.checkInAt, after: curr.checkInAt };
  }
  if (prev.checkOutAt !== curr.checkOutAt) {
    changes.checkOutAt = { before: prev.checkOutAt, after: curr.checkOutAt };
  }
  if (prev.durationMinutes !== curr.durationMinutes) {
    changes.durationMinutes = { before: prev.durationMinutes, after: curr.durationMinutes };
  }
  if (curr.rules && prev.rules.hourlyRateMinor !== curr.rules.hourlyRateMinor) {
    changes.hourlyRateMinor = { before: prev.rules.hourlyRateMinor, after: curr.rules.hourlyRateMinor };
  }
  if (prev.earnings.basePayMinor !== curr.earnings.basePayMinor) {
    changes.basePayMinor = { before: prev.earnings.basePayMinor, after: curr.earnings.basePayMinor };
  }
  if (prev.earnings.overtimeMinutes !== curr.earnings.overtimeMinutes) {
    changes.overtimeMinutes = { before: prev.earnings.overtimeMinutes, after: curr.earnings.overtimeMinutes };
  }
  if (prev.earnings.overtimePayMinor !== curr.earnings.overtimePayMinor) {
    changes.overtimePayMinor = { before: prev.earnings.overtimePayMinor, after: curr.earnings.overtimePayMinor };
  }
  if (prev.earnings.grossPayMinor !== curr.earnings.grossPayMinor) {
    changes.grossPayMinor = {
      before: prev.earnings.grossPayMinor,
      after: curr.earnings.grossPayMinor,
      deltaMinor: curr.earnings.grossPayMinor - prev.earnings.grossPayMinor,
    };
  }

  return {
    previousVersion: prev.version,
    correctedAt: meta.correctedAt,
    correctedBy: meta.correctedBy,
    reason: meta.reason,
    changes,
  };
}
