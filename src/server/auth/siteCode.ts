// Rotating site check-in code: a 6-digit code derived from the server secret, the
// organisation and a 5-minute time window. A supervisor shows it at the gate (screen or
// printout read aloud); workers type it when checking in. It is accepted in its own window
// and the next one, so it expires within 10 minutes. It proves the worker saw the current
// code, not their physical location: someone could relay it by phone.
import { createHmac } from 'node:crypto';
import { safeEqual } from './crypto';

export const SITE_CODE_WINDOW_MS = 5 * 60 * 1000;

function codeForWindow(secret: string, orgId: string, window: number): string {
  const digest = createHmac('sha256', secret).update(`site-code:${orgId}:${window}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

export function currentSiteCode(secret: string, orgId: string, now: Date): { code: string; validUntil: string } {
  const window = Math.floor(now.getTime() / SITE_CODE_WINDOW_MS);
  return { code: codeForWindow(secret, orgId, window), validUntil: new Date((window + 2) * SITE_CODE_WINDOW_MS - 1).toISOString() };
}

/** True when the code matches the current or the previous window for this organisation. */
export function verifySiteCode(secret: string, orgId: string, now: Date, code: string): boolean {
  const window = Math.floor(now.getTime() / SITE_CODE_WINDOW_MS);
  return [window, window - 1].some((w) => safeEqual(codeForWindow(secret, orgId, w), code));
}
