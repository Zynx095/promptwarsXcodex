// Input validation schemas, enforced at the API boundary and reused by client forms.
import { z } from 'zod';
import { isLocalDate } from './time';
import { FEEDBACK_STATUSES, REPORT_STATUSES, SEVERITIES } from './types';
import { INSPECTION_CHECKS } from './industries';
import { SITE_QR_TOKEN_RE } from './siteQr';

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export const localDateSchema = z.string().refine(isLocalDate, 'Use a valid date in YYYY-MM-DD format');
export const isoInstantSchema = z.string().refine((v) => ISO_INSTANT_RE.test(v) && !Number.isNaN(Date.parse(v)), 'Use a valid date and time');

const text = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

export const loginSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Enter your 10-digit phone number'),
  pin: z
    .string()
    .trim()
    .regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits'),
});

export const dateRangeSchema = z
  .object({ from: localDateSchema.optional(), to: localDateSchema.optional() })
  .refine((r) => !r.from || !r.to || r.from <= r.to, { message: '"From" must be on or before "To"', path: ['to'] });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export const shiftQuerySchema = paginationSchema.extend({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  workerId: z.string().max(64).optional(),
  status: z.enum(['open', 'completed']).optional(),
});

export const shiftCorrectionSchema = z.object({
  checkInAt: isoInstantSchema,
  checkOutAt: isoInstantSchema.nullable(),
  reason: text(5, 500, 'Reason'),
  isPayrollAdjustment: z.boolean().optional(),
});

export const reportCreateSchema = z.object({
  category: z.string().trim().min(1, 'Choose a category').max(40),
  severity: z.enum(SEVERITIES, { error: 'Choose how serious the hazard is' }),
  title: text(3, 120, 'Short title'),
  description: text(10, 2000, 'Description'),
  location: text(2, 120, 'Location'),
  confidential: z.boolean().default(false),
  siteId: z.string().trim().max(64).nullable().optional(),
  inspectionChecks: z
    .array(z.enum(INSPECTION_CHECKS))
    .max(INSPECTION_CHECKS.length)
    .refine((c) => new Set(c).size === c.length, 'Each inspection point can be chosen once')
    .default([]),
  /** Random ID from the phone so a report retried after a lost connection is stored once. */
  clientRequestId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .optional(),
});

export const evidenceUploadSchema = z.object({
  stage: z.enum(['hazard', 'remediation']),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp'], { error: 'Only JPEG, PNG or WebP photos can be added' }),
  data: z.string().min(1).max(2_100_000, 'The photo is too large'),
  caption: z.string().trim().max(200, 'Caption must be at most 200 characters').optional(),
});

export const evidenceReviewSchema = z.object({
  decision: z.enum(['confirmed', 'dismissed']),
  note: z.string().trim().max(500, 'Note must be at most 500 characters').default(''),
});

export const fixResponseSchema = z
  .object({
    decision: z.enum(['confirmed', 'disputed']),
    note: z.string().trim().max(1000, 'Note must be at most 1000 characters').default(''),
  })
  .refine((r) => r.decision === 'confirmed' || r.note.length >= 3, { message: 'Say what is still wrong', path: ['note'] });

export const reportQuerySchema = paginationSchema.extend({
  status: z.enum([...REPORT_STATUSES, 'unresolved']).optional(),
  severity: z.enum(SEVERITIES).optional(),
  category: z.string().max(40).optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
});

export const reportTransitionSchema = z.object({
  to: z.enum(REPORT_STATUSES),
  note: z.string().trim().max(1000, 'Note must be at most 1000 characters').default(''),
  assignee: z.string().trim().max(80, 'Assignee must be at most 80 characters').nullable().optional(),
  actionTaken: z.string().trim().max(500, 'Action taken must be at most 500 characters').nullable().optional(),
  followUpDate: localDateSchema.nullable().optional(),
  verifiedBy: z.string().trim().max(80, 'Verifier name must be at most 80 characters').nullable().optional(),
  verificationNote: z.string().trim().max(1000, 'Verification note must be at most 1000 characters').nullable().optional(),
});

export const feedbackCreateSchema = z
  .object({
    category: z.string().trim().min(1, 'Choose a topic').max(40),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    comment: z.string().trim().max(1000, 'Comment must be at most 1000 characters').optional(),
  })
  .refine((f) => f.rating != null || (f.comment && f.comment.length > 0), {
    message: 'Give a rating or write a comment',
    path: ['comment'],
  });

export const feedbackQuerySchema = paginationSchema.extend({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  category: z.string().max(40).optional(),
});

export const feedbackStatusSchema = z.object({ status: z.enum(FEEDBACK_STATUSES) });

const deductionSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,19}$/, 'Code must be 2-20 lowercase letters, digits or _'),
    label: text(2, 60, 'Label'),
    kind: z.enum(['percent_of_gross', 'percent_of_base', 'fixed']),
    value: z.number().int().min(0),
  })
  .refine((d) => (d.kind === 'fixed' ? d.value <= 10_000_000 : d.value <= 10000), {
    message: 'Percentage cannot exceed 100% and fixed amounts cannot exceed 1,00,000',
    path: ['value'],
  });

/** A WebAuthn assertion as the browser returns it (all binary fields base64url). Verified on the server. */
const b64url = z
  .string()
  .regex(/^[A-Za-z0-9_-]*$/)
  .max(4096);
export const passkeyAssertionSchema = z.object({
  id: b64url.min(1),
  rawId: b64url.min(1),
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: b64url.min(1),
    authenticatorData: b64url.min(1),
    signature: b64url.min(1),
    userHandle: b64url.optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
});

export const passkeyRegistrationSchema = z.object({
  label: z.string().trim().max(60).default(''),
  response: z.object({
    id: b64url.min(1),
    rawId: b64url.min(1),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: b64url.min(1),
      attestationObject: z
        .string()
        .regex(/^[A-Za-z0-9_-]*$/)
        .max(16384)
        .min(1),
      transports: z.array(z.string().max(20)).max(10).optional(),
      authenticatorData: b64url.optional(),
      publicKey: b64url.optional(),
      publicKeyAlgorithm: z.number().int().optional(),
    }),
    clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  }),
});

export { SITE_QR_TOKEN_RE };
export const siteQrTokenSchema = z.string().trim().regex(SITE_QR_TOKEN_RE, 'This is not a FairShift site QR code');

/** When a phone saved an action while offline (its own clock): recorded for review, never used as the time. */
const queuedAtSchema = isoInstantSchema.optional();

export const checkInSchema = z.object({
  siteCode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit site code')
    .optional(),
  qrToken: siteQrTokenSchema.optional(),
  passkey: passkeyAssertionSchema.optional(),
  queuedAt: queuedAtSchema,
});

export const checkOutSchema = z.object({
  passkey: passkeyAssertionSchema.optional(),
  queuedAt: queuedAtSchema,
});

export const qrResolveSchema = z.object({ token: siteQrTokenSchema });

export const paymentCreateSchema = z
  .object({
    workerId: z.string().min(1).max(64),
    periodStart: localDateSchema,
    periodEnd: localDateSchema,
    amountMinor: z
      .number()
      .int('Amount must be in whole paise')
      .min(-100_000_000)
      .max(100_000_000)
      .refine((v) => v !== 0, 'Amount cannot be zero'),
    kind: z.enum(['payment', 'adjustment']).default('payment'),
    method: z.enum(['cash', 'bank_transfer', 'upi', 'cheque', 'other']),
    paidOn: localDateSchema,
    reference: z.string().trim().max(80, 'Reference must be at most 80 characters').default(''),
    note: z.string().trim().max(300, 'Note must be at most 300 characters').default(''),
  })
  .refine((p) => p.periodStart <= p.periodEnd, { message: '"From" must be on or before "To"', path: ['periodEnd'] })
  .refine((p) => (Date.parse(p.periodEnd) - Date.parse(p.periodStart)) / 86400000 <= 62, {
    message: 'A payment can cover at most 62 days',
    path: ['periodEnd'],
  })
  .refine((p) => p.kind === 'adjustment' || p.amountMinor > 0, { message: 'A payment must be more than zero', path: ['amountMinor'] })
  .refine((p) => p.kind === 'payment' || p.note.length >= 3, { message: 'Say why the adjustment is needed', path: ['note'] });

export const payCheckQuerySchema = dateRangeSchema.refine((r) => !r.from || !r.to || (Date.parse(r.to) - Date.parse(r.from)) / 86400000 <= 93, {
  message: 'Choose a period of at most 93 days',
  path: ['to'],
});

export const orgSettingsSchema = z.object({
  pay: z.object({
    scheduledDailyMinutes: z.number().int().min(60).max(960),
    overtimeMultiplierBp: z.number().int().min(10000, 'Overtime multiplier must be at least 1×').max(30000),
    deductions: z
      .array(deductionSchema)
      .max(8)
      .refine((ds) => new Set(ds.map((d) => d.code)).size === ds.length, 'Deduction codes must be unique')
      .refine((ds) => ds.filter((d) => d.kind !== 'fixed').reduce((s, d) => s + d.value, 0) <= 10000, 'Percentage deductions cannot add up to more than 100%'),
  }),
  fatigue: z
    .object({
      maxDailyMinutes: z.number().int().min(60).max(1440),
      maxWeeklyMinutes: z
        .number()
        .int()
        .min(60)
        .max(7 * 1440),
      minRestMinutes: z.number().int().min(0).max(1440),
      overtimeDaysPerWeek: z.number().int().min(1).max(7),
    })
    .refine((f) => f.maxWeeklyMinutes >= f.maxDailyMinutes, {
      message: 'Weekly limit must be at least the daily limit',
      path: ['maxWeeklyMinutes'],
    }),
  attendance: z.object({ requireSiteCode: z.boolean() }).default({ requireSiteCode: false }),
});

export const workerUpdateSchema = z.object({
  hourlyRateMinor: z.number().int().min(1, 'Rate must be positive').max(1_000_000).optional(),
  active: z.boolean().optional(),
});

export const payslipIssueSchema = z
  .object({ workerId: z.string().min(1).max(64), from: localDateSchema, to: localDateSchema })
  .refine((p) => p.from <= p.to, { message: '"From" must be on or before "To"', path: ['to'] })
  .refine((p) => (Date.parse(p.to) - Date.parse(p.from)) / 86400000 <= 31, {
    message: 'A pay period can be at most 31 days',
    path: ['to'],
  });

export const skillCreateSchema = z
  .object({
    kind: z.enum(['skill', 'training', 'certification']),
    name: text(2, 100, 'Name'),
    description: z.string().trim().max(500).default(''),
    issuer: z.string().trim().max(100).default(''),
    issuedOn: localDateSchema.nullable().optional(),
    expiresOn: localDateSchema.nullable().optional(),
  })
  .refine((s) => !s.issuedOn || !s.expiresOn || s.expiresOn >= s.issuedOn, {
    message: 'Expiry date must be after the issue date',
    path: ['expiresOn'],
  });

export const skillVerifySchema = z.object({ verified: z.boolean() });

export const workerCreateSchema = z.object({
  name: text(2, 100, 'Name'),
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Enter a 10-digit phone number'),
  jobTitle: z.string().trim().max(100).default(''),
  team: z.string().trim().max(100).default(''),
  hourlyRateMinor: z.number().int().min(1, 'Hourly rate must be at least 1').max(1_000_000),
  pin: z
    .string()
    .trim()
    .regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits')
    .default('1234'),
});

export const siteCreateSchema = z.object({
  name: text(2, 100, 'Site name'),
  code: z
    .string()
    .trim()
    .min(2, 'Site code must be 2 to 10 characters')
    .max(10, 'Site code must be at most 10 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'Site code must be alphanumeric (letters, numbers, hyphens)'),
  address: z.string().trim().max(200).default(''),
});

export const phoneOtpRequestSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Enter your 10-digit phone number'),
});

export const phoneOtpVerifySchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Enter your 10-digit phone number'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit verification code'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type PhoneOtpRequestInput = z.infer<typeof phoneOtpRequestSchema>;
export type PhoneOtpVerifyInput = z.infer<typeof phoneOtpVerifySchema>;
export type ShiftCorrectionInput = z.infer<typeof shiftCorrectionSchema>;
export type ReportCreateInput = z.infer<typeof reportCreateSchema>;
export type PasskeyAssertion = z.infer<typeof passkeyAssertionSchema>;
export type ReportTransitionInput = z.infer<typeof reportTransitionSchema>;
export type FeedbackCreateInput = z.infer<typeof feedbackCreateSchema>;
export type OrgSettingsInput = z.infer<typeof orgSettingsSchema>;
export type SkillCreateInput = z.infer<typeof skillCreateSchema>;
export type WorkerCreateInput = z.infer<typeof workerCreateSchema>;
export type SiteCreateInput = z.infer<typeof siteCreateSchema>;
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
