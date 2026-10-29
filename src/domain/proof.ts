// FairShift Proof — Canonical serialization, cryptographic digests, and earnings calculations.
import { createHmac } from 'node:crypto';
import { safeEqual } from '../server/auth/crypto';
import { payForMinutes } from '../shared/money';
import { minutesBetween } from '../shared/time';
import { DomainError } from './errors';

export interface ReceiptCalculationRule {
  scheduledDailyMinutes: number;
  hourlyRateMinor: number;
  overtimeMultiplierBp: number;
  currency: string;
}

export interface ReceiptEarningsBreakdown {
  durationMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  basePayMinor: number;
  overtimePayMinor: number;
  grossPayMinor: number;
  estimatedNetPayMinor: number;
}

export interface ReceiptCorrectionDiff {
  previousVersion: number;
  correctedAt: string;
  correctedBy: string;
  reason: string;
  changes: {
    checkInAt?: { before: string; after: string };
    checkOutAt?: { before: string | null; after: string | null };
    durationMinutes?: { before: number; after: number };
    overtimeMinutes?: { before: number; after: number };
    grossPayMinor?: { before: number; after: number; deltaMinor: number };
  };
}

export interface CanonicalReceiptData {
  shiftId: string;
  workerId: string;
  orgId: string;
  version: number;
  status: 'estimated' | 'finalized';
  checkInAt: string;
  checkOutAt: string;
  durationMinutes: number;
  rules: ReceiptCalculationRule;
  earnings: ReceiptEarningsBreakdown;
  issuedAt: string;
  correction?: ReceiptCorrectionDiff;
}

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
  const canonicalString = canonicalizeJson(data);
  return createHmac('sha256', secret).update(canonicalString).digest('hex');
}

/**
 * Verifies that the provided receipt data matches its stored cryptographic digest.
 */
export function verifyReceiptDigest(secret: string, data: CanonicalReceiptData, expectedDigest: string): boolean {
  if (!expectedDigest || typeof expectedDigest !== 'string') return false;
  const computed = computeReceiptDigest(secret, data);
  return safeEqual(computed, expectedDigest);
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
  if (prev.earnings.overtimeMinutes !== curr.earnings.overtimeMinutes) {
    changes.overtimeMinutes = { before: prev.earnings.overtimeMinutes, after: curr.earnings.overtimeMinutes };
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
