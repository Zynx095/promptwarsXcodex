import { describe, expect, it } from 'vitest';
import {
  feedbackCreateSchema,
  loginSchema,
  orgSettingsSchema,
  payslipIssueSchema,
  reportCreateSchema,
  shiftCorrectionSchema,
  skillCreateSchema,
} from '../../src/shared/schemas';

describe('input validation', () => {
  it('validates login identifiers', () => {
    expect(loginSchema.safeParse({ phone: '9000000001', pin: '1234' }).success).toBe(true);
    expect(loginSchema.safeParse({ phone: '900', pin: '1234' }).success).toBe(false);
    expect(loginSchema.safeParse({ phone: '9000000001', pin: 'abcd' }).success).toBe(false);
  });

  it('requires complete, well-formed hazard reports', () => {
    const ok = { category: 'fall', severity: 'high', title: 'Open edge', description: 'No guardrail on the slab edge', location: 'Tower B' };
    expect(reportCreateSchema.parse(ok).confidential).toBe(false);
    expect(reportCreateSchema.safeParse({ ...ok, severity: 'extreme' }).success).toBe(false);
    expect(reportCreateSchema.safeParse({ ...ok, description: 'short' }).success).toBe(false);
    expect(reportCreateSchema.safeParse({ ...ok, title: '   ' }).success).toBe(false);
  });

  it('requires a rating or a comment for feedback', () => {
    expect(feedbackCreateSchema.safeParse({ category: 'pay' }).success).toBe(false);
    expect(feedbackCreateSchema.safeParse({ category: 'pay', rating: 6 }).success).toBe(false);
    expect(feedbackCreateSchema.safeParse({ category: 'pay', rating: 4 }).success).toBe(true);
    expect(feedbackCreateSchema.safeParse({ category: 'pay', comment: 'Late wages' }).success).toBe(true);
  });

  it('requires a reason and valid timestamps for shift corrections', () => {
    expect(shiftCorrectionSchema.safeParse({ checkInAt: '2026-10-27T08:00:00Z', checkOutAt: null, reason: 'Forgot to check out' }).success).toBe(true);
    expect(shiftCorrectionSchema.safeParse({ checkInAt: '2026-10-27T08:00:00Z', checkOutAt: null, reason: '' }).success).toBe(false);
    expect(shiftCorrectionSchema.safeParse({ checkInAt: 'yesterday', checkOutAt: null, reason: 'Forgot' }).success).toBe(false);
  });

  it('bounds pay periods and pay rules', () => {
    expect(payslipIssueSchema.safeParse({ workerId: 'w', from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(payslipIssueSchema.safeParse({ workerId: 'w', from: '2026-10-01', to: '2026-11-15' }).success).toBe(false);
    expect(payslipIssueSchema.safeParse({ workerId: 'w', from: '2026-10-10', to: '2026-10-01' }).success).toBe(false);
    const settings = {
      pay: { scheduledDailyMinutes: 480, overtimeMultiplierBp: 15000, deductions: [] },
      fatigue: { maxDailyMinutes: 600, maxWeeklyMinutes: 3600, minRestMinutes: 600, overtimeDaysPerWeek: 3 },
    };
    expect(orgSettingsSchema.safeParse(settings).success).toBe(true);
    expect(orgSettingsSchema.safeParse({ ...settings, pay: { ...settings.pay, overtimeMultiplierBp: 5000 } }).success).toBe(false);
    expect(orgSettingsSchema.safeParse({ ...settings, fatigue: { ...settings.fatigue, maxWeeklyMinutes: 300 } }).success).toBe(false);
  });

  it('rejects expiry before issue on skill records', () => {
    expect(skillCreateSchema.safeParse({ kind: 'certification', name: 'First aid', issuedOn: '2026-01-01', expiresOn: '2025-01-01' }).success).toBe(false);
  });
});
