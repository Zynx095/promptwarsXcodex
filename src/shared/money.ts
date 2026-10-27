// Money is represented as integer minor units (paise for INR) to avoid floating-point drift.
// Multipliers and percentages are integer basis points (10000 bp = 100% = 1x).

export const BP = 10000;

function assertSafeNonNegativeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${value}`);
  }
}

/** Integer division with half-up rounding for non-negative integers. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  assertSafeNonNegativeInt(numerator, 'numerator');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) throw new RangeError('denominator must be a positive integer');
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  return r * 2 >= denominator ? q + 1 : q;
}

/** Pay for a number of minutes at an hourly rate, optionally multiplied (basis points). */
export function payForMinutes(minutes: number, hourlyRateMinor: number, multiplierBp: number = BP): number {
  assertSafeNonNegativeInt(minutes, 'minutes');
  assertSafeNonNegativeInt(hourlyRateMinor, 'hourlyRateMinor');
  assertSafeNonNegativeInt(multiplierBp, 'multiplierBp');
  const numerator = minutes * hourlyRateMinor * multiplierBp;
  if (!Number.isSafeInteger(numerator)) throw new RangeError('pay calculation overflow');
  return divRoundHalfUp(numerator, 60 * BP);
}

/** Percentage (basis points) of an amount, rounded half-up. */
export function percentOf(amountMinor: number, bp: number): number {
  assertSafeNonNegativeInt(amountMinor, 'amountMinor');
  assertSafeNonNegativeInt(bp, 'bp');
  return divRoundHalfUp(amountMinor * bp, BP);
}

const MONEY_RE = /^\d{1,7}(\.\d{1,2})?$/;

/** Parse a decimal string like "125.50" into minor units. Returns null on malformed input. */
export function parseMajorToMinor(value: string): number | null {
  const v = value.trim();
  if (!MONEY_RE.test(v)) return null;
  const [whole, frac = ''] = v.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function minorToMajorString(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatMoney(minor: number, currency = 'INR', locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(minor / 100);
}

export function formatMultiplier(bp: number): string {
  return `${(bp / BP).toFixed(2).replace(/\.?0+$/, '')}×`;
}

export function formatPercent(bp: number): string {
  return `${(bp / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}
