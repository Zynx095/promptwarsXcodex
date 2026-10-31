// Rotating site QR tokens. A token names one site and the second it was issued, carries a random
// nonce and an HMAC over all of that plus the organisation, so it cannot be edited (to another site,
// another organisation or a later time) without the server secret. The token on its own is not an
// attendance credential: the server also requires the nonce to be one it issued, still live by its
// own clock, for a display that is still active, never used before by this worker, and the worker's
// normal signed-in session (plus their passkey, when they have one).
//
// Format: 1.<SITECODE>.<issued second, base 36>.<nonce, 8 base64url>.<signature, 16 base64url>
// It is short on purpose: as a link (https://host/c/<token>) it still fits a version 6 QR code.
import { createHmac, randomBytes } from 'node:crypto';
import { SITE_QR_TOKEN_RE } from '../../shared/siteQr';
import { safeEqual } from './crypto';

/** The display shows a new code this often. */
export const QR_ROTATE_SECONDS = 30;
/** A code is accepted for this long after it was issued, so one rotation of grace for a slow scan. */
export const QR_TTL_SECONDS = 60;

export interface ParsedSiteQr {
  siteCode: string;
  issuedSec: number;
  nonce: string;
  signature: string;
}

function sign(secret: string, orgId: string, siteId: string, siteCode: string, issuedSec: number, nonce: string): string {
  return createHmac('sha256', secret).update(`site-qr:v1:${orgId}:${siteId}:${siteCode}:${issuedSec}:${nonce}`).digest().subarray(0, 12).toString('base64url');
}

export function newQrNonce(): string {
  return randomBytes(6).toString('base64url');
}

export function buildSiteQrToken(secret: string, orgId: string, siteId: string, siteCode: string, issuedAt: Date, nonce: string): string {
  const issuedSec = Math.floor(issuedAt.getTime() / 1000);
  return `1.${siteCode}.${issuedSec.toString(36)}.${nonce}.${sign(secret, orgId, siteId, siteCode, issuedSec, nonce)}`;
}

/** Splits a token into its parts; null when it is not in the expected shape. */
export function parseSiteQrToken(token: string): ParsedSiteQr | null {
  if (!SITE_QR_TOKEN_RE.test(token)) return null;
  const [, siteCode, issued, nonce, signature] = token.split('.');
  const issuedSec = parseInt(issued!, 36);
  if (!Number.isSafeInteger(issuedSec) || issuedSec <= 0) return null;
  return { siteCode: siteCode!, issuedSec, nonce: nonce!, signature: signature! };
}

/** True when the signature matches this organisation and site. Constant-time comparison. */
export function verifySiteQrSignature(secret: string, orgId: string, siteId: string, parsed: ParsedSiteQr): boolean {
  return safeEqual(sign(secret, orgId, siteId, parsed.siteCode, parsed.issuedSec, parsed.nonce), parsed.signature);
}
