import { describe, expect, it } from 'vitest';
import { SITE_CODE_WINDOW_MS, currentSiteCode, verifySiteCode } from '../../src/server/auth/siteCode';
import { attendanceTrend } from '../../src/domain/dashboard';

const SECRET = 'unit-test-secret-'.padEnd(40, 'x');
const t0 = new Date('2026-10-27T03:30:00.000Z');

describe('rotating site check-in code', () => {
  it('produces a 6-digit code that is stable within a window', () => {
    const a = currentSiteCode(SECRET, 'org-a', t0);
    expect(a.code).toMatch(/^\d{6}$/);
    expect(currentSiteCode(SECRET, 'org-a', new Date(t0.getTime() + 1000)).code).toBe(a.code);
  });

  it('differs between organisations and secrets', () => {
    const a = currentSiteCode(SECRET, 'org-a', t0).code;
    expect(currentSiteCode(SECRET, 'org-b', t0).code).not.toBe(a);
    expect(currentSiteCode(`${SECRET}y`, 'org-a', t0).code).not.toBe(a);
  });

  it('is accepted in its own and the next window only', () => {
    const { code, validUntil } = currentSiteCode(SECRET, 'org-a', t0);
    expect(verifySiteCode(SECRET, 'org-a', t0, code)).toBe(true);
    expect(verifySiteCode(SECRET, 'org-a', new Date(Date.parse(validUntil)), code)).toBe(true);
    expect(verifySiteCode(SECRET, 'org-a', new Date(Date.parse(validUntil) + 1), code)).toBe(false);
    expect(verifySiteCode(SECRET, 'org-b', t0, code)).toBe(false);
    expect(Date.parse(validUntil) - t0.getTime()).toBeLessThanOrEqual(2 * SITE_CODE_WINDOW_MS);
  });

  it('rejects malformed codes without throwing', () => {
    expect(verifySiteCode(SECRET, 'org-a', t0, '12345')).toBe(false);
    expect(verifySiteCode(SECRET, 'org-a', t0, 'abcdef')).toBe(false);
  });
});

describe('attendance trend', () => {
  it('counts distinct workers per day and sums daily overtime, including empty days', () => {
    const trend = attendanceTrend(
      [
        { workerId: 'w1', checkInAt: '2026-10-26T00:00:00Z', checkOutAt: '2026-10-26T09:00:00Z' },
        { workerId: 'w1', checkInAt: '2026-10-26T10:00:00Z', checkOutAt: '2026-10-26T11:00:00Z' },
        { workerId: 'w2', checkInAt: '2026-10-26T00:00:00Z', checkOutAt: '2026-10-26T08:00:00Z' },
        { workerId: 'w3', checkInAt: '2026-10-28T00:00:00Z', checkOutAt: null },
      ],
      ['2026-10-26', '2026-10-27', '2026-10-28'],
      'UTC',
      480,
    );
    expect(trend).toEqual([
      { date: '2026-10-26', present: 2, overtimeMinutes: 120 },
      { date: '2026-10-27', present: 0, overtimeMinutes: 0 },
      { date: '2026-10-28', present: 1, overtimeMinutes: 0 },
    ]);
  });
});
