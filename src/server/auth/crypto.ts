import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_KEYLEN = 32;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = scryptSync(pin, Buffer.from(saltB64, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Legacy keyed reference linking a confidential report to its reporter without storing their ID. */
export function reporterRef(secret: string, userId: string): string {
  return hmac(secret, `confidential-report:${userId}`);
}

/**
 * Domain-separated keyed reference linking a confidential report to its reporter with organization isolation.
 */
export function scopedReporterRef(secret: string, orgId: string, userId: string): string {
  return hmac(secret, `fairshift:confidential-report:${orgId}:${userId}`);
}

/**
 * Generates an opaque one-way pseudonym for internal signal aggregation, eliminating raw user IDs from domain memory.
 */
export function signalAggregationKey(secret: string, orgId: string, rawKey: string): string {
  return hmac(secret, `fairshift:signal-aggregation:${orgId}:${rawKey}`);
}
