// Data contracts shared between the API and the web client.
import type { IndustryKey } from './industries';

export type Role = 'worker' | 'admin';

export interface SessionUser {
  id: string;
  orgId: string;
  role: Role;
  name: string;
  jobTitle: string;
  team: string;
}

export interface OrgSummary {
  id: string;
  name: string;
  industry: IndustryKey;
  timezone: string;
  currency: string;
  synthetic: boolean;
}

export interface MeResponse {
  user: SessionUser;
  org: OrgSummary;
  demoMode: boolean;
}

export interface DemoAccount {
  name: string;
  role: Role;
  phone: string;
  orgName: string;
  industry: IndustryKey;
  jobTitle: string;
}

// ---- Attendance ----

export type AttendanceState = 'not_started' | 'on_shift' | 'completed';
export type ShiftSource = 'app' | 'seed' | 'correction';
/** How a check-in was made: plain app tap, or with the rotating site code shown at the workplace. */
export type CheckInMethod = 'app' | 'site_code';

export interface ShiftDTO {
  id: string;
  workerId: string;
  workerName?: string;
  checkInAt: string;
  checkOutAt: string | null;
  status: 'open' | 'completed';
  durationMinutes: number | null;
  localDate: string;
  source: ShiftSource;
  checkInMethod: CheckInMethod;
  corrected: boolean;
  synthetic: boolean;
}

export interface DaySummary {
  date: string;
  workedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  shiftCount: number;
}

export interface AttendanceStatusDTO {
  state: AttendanceState;
  openShift: ShiftDTO | null;
  today: DaySummary;
  scheduledDailyMinutes: number;
  requireSiteCode: boolean;
}

// ---- Rules ----

export type DeductionKind = 'percent_of_gross' | 'percent_of_base' | 'fixed';

export interface DeductionRule {
  code: string;
  label: string;
  kind: DeductionKind;
  /** Basis points for percentages, minor currency units for fixed amounts. */
  value: number;
}

export interface PayRules {
  scheduledDailyMinutes: number;
  overtimeMultiplierBp: number;
  deductions: DeductionRule[];
}

export interface FatigueRules {
  maxDailyMinutes: number;
  maxWeeklyMinutes: number;
  minRestMinutes: number;
  overtimeDaysPerWeek: number;
}

export interface AttendanceRules {
  /** When true, workers must enter the current site code to check in. */
  requireSiteCode: boolean;
}

export interface OrgSettings {
  pay: PayRules;
  fatigue: FatigueRules;
  attendance: AttendanceRules;
}

export interface SiteCodeDTO {
  code: string;
  /** Last instant at which this code is accepted (UTC ISO). */
  validUntil: string;
  requireSiteCode: boolean;
}

export interface TrendPoint {
  date: string;
  present: number;
  overtimeMinutes: number;
}

// ---- Pay ----

export interface DeductionLine {
  code: string;
  label: string;
  kind: DeductionKind;
  value: number;
  amountMinor: number;
  /** True when the deduction was reduced so net pay cannot go below zero. */
  capped: boolean;
}

export interface PayBreakdown {
  hourlyRateMinor: number;
  scheduledDailyMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  overtimeMultiplierBp: number;
  basePayMinor: number;
  overtimePayMinor: number;
  grossPayMinor: number;
  deductions: DeductionLine[];
  totalDeductionsMinor: number;
  netPayMinor: number;
  days: DaySummary[];
  openShiftsExcluded: number;
}

export interface PayslipDTO {
  id: string | null;
  workerId: string;
  workerName: string;
  periodStart: string;
  periodEnd: string;
  status: 'issued' | 'preview';
  issuedAt: string | null;
  synthetic: boolean;
  currency: string;
  breakdown: PayBreakdown;
}

export interface PayslipListItem {
  id: string;
  workerId: string;
  workerName: string;
  periodStart: string;
  periodEnd: string;
  netPayMinor: number;
  grossPayMinor: number;
  issuedAt: string;
  synthetic: boolean;
}

// ---- Safety ----

export const REPORT_STATUSES = ['submitted', 'acknowledged', 'in_progress', 'resolved', 'follow_up_pending', 'outcome_verified', 'reopened'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface ReportEventDTO {
  id: string;
  fromStatus: ReportStatus | null;
  toStatus: ReportStatus;
  note: string;
  actorLabel: string;
  createdAt: string;
}

export interface SafetyReportDTO {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  description: string;
  location: string;
  status: ReportStatus;
  confidential: boolean;
  /** Null when the report is confidential and the viewer is not the reporter. */
  reporterName: string | null;
  isMine: boolean;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  actionTaken?: string | null;
  followUpDate?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  verificationNote?: string | null;
  synthetic: boolean;
  history?: ReportEventDTO[];
}

// ---- Feedback ----

export const FEEDBACK_STATUSES = ['new', 'reviewed', 'actioned', 'hidden'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface FeedbackDTO {
  id: string;
  category: string;
  rating: number | null;
  comment: string | null;
  status: FeedbackStatus;
  submittedOn: string;
  synthetic: boolean;
}

export interface FeedbackSummary {
  category: string;
  label: string;
  count: number;
  /** Null when fewer responses than the privacy threshold exist. */
  averageRating: number | null;
  suppressed: boolean;
}

// ---- Fatigue-risk alerts ----

export const FATIGUE_RULES = ['daily_hours', 'weekly_hours', 'short_rest', 'repeated_overtime'] as const;
export type FatigueRuleKey = (typeof FATIGUE_RULES)[number];

export interface AlertDTO {
  id: string;
  workerId: string;
  workerName: string;
  rule: FatigueRuleKey;
  windowKey: string;
  observedValue: number;
  threshold: number;
  details: string;
  status: 'open' | 'acknowledged';
  createdAt: string;
  acknowledgedAt: string | null;
}

// ---- Skills ----

export type SkillKind = 'skill' | 'training' | 'certification';
export type Verification = 'self_reported' | 'employer_verified';

export interface SkillDTO {
  id: string;
  workerId: string;
  kind: SkillKind;
  name: string;
  description: string;
  issuer: string;
  issuedOn: string | null;
  expiresOn: string | null;
  verification: Verification;
  verifiedByName: string | null;
  createdAt: string;
  expired: boolean;
  synthetic: boolean;
}

// ---- Admin ----

export interface WorkerDTO {
  id: string;
  name: string;
  phone: string;
  jobTitle: string;
  team: string;
  hourlyRateMinor: number;
  active: boolean;
  attendanceState: AttendanceState;
  synthetic: boolean;
}

export interface AuditEventDTO {
  id: string;
  actorName: string;
  entityType: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export interface ActivityItem {
  at: string;
  kind: 'check_in' | 'check_out' | 'correction' | 'report_created' | 'report_status';
  text: string;
  link: string | null;
}

export interface DashboardDTO {
  range: { from: string; to: string };
  totalWorkers: number;
  onShiftNow: number;
  completedShifts: number;
  workedMinutes: number;
  overtimeMinutes: number;
  workersWithOvertime: number;
  openReports: number;
  criticalUnresolved: number;
  openAlerts: number;
  recentActivity: ActivityItem[];
  trend: TrendPoint[];
  feedback: { total: number; summaries: FeedbackSummary[] };
  synthetic: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

// ---- Authentication Configuration & Identities ----

export type AuthProviderKey = 'google' | 'phone_otp' | 'github' | 'demo_pin';

export interface ProviderConfigInfo {
  configured: boolean;
  name: string;
}

export interface AuthConfigResponse {
  demoMode: boolean;
  providers: {
    google: ProviderConfigInfo;
    phoneOtp: ProviderConfigInfo;
    github: ProviderConfigInfo;
  };
}

export interface AuthIdentityDTO {
  id: string;
  userId: string;
  provider: AuthProviderKey;
  providerUserId: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
}

// ---- FairShift Proof (Work Receipts) ----

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

export interface WorkReceiptDTO {
  id: string;
  shiftId: string;
  workerId: string;
  orgId: string;
  version: number;
  previousVersionId: string | null;
  canonicalDigest: string;
  status: 'estimated' | 'finalized';
  data: CanonicalReceiptData;
  correctionReason: string | null;
  createdAt: string;
  createdBy: string | null;
  verified?: boolean;
}

// ---- Safe Signal (Recurring Hazard Detection) ----

export type SignalRuleType = 'category_cluster' | 'persistent_unresolved' | 'severity_escalation' | 'reopened_cluster';

export interface SafeSignalDTO {
  id: string;
  rule: SignalRuleType;
  title: string;
  category: string;
  categoryLabel: string;
  severityLevel: Severity;
  reportCount: number;
  timeWindow: string;
  severityDistribution: Record<Severity, number>;
  statusSummary: {
    unresolvedCount: number;
    resolvedCount: number;
    reopenedCount: number;
  };
  confidence: 'possible_pattern' | 'recurrent_hazard';
  recommendedActions: string[];
}

export interface SafeSignalResponse {
  signals: SafeSignalDTO[];
  cohortThreshold: number;
  analyzedReportCount: number;
}

// ---- FairShift Accountability Loop ----

export interface AccountabilityMetricsDTO {
  totalReports: number;
  openReports: number;
  resolvedCount: number;
  followUpPendingCount: number;
  verifiedCount: number;
  reopenedCount: number;
  meanTimeToAcknowledgeMinutes: number | null;
  meanTimeToResolveMinutes: number | null;
  verificationRatePercent: number;
  reopenRatePercent: number;
  overdueFollowUps: number;
}


