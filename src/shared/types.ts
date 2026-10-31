// Data contracts shared between the API and the web client.
import type { IndustryKey, PpeItem } from './industries';

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
/** How a check-in was made: plain app tap, the rotating 6-digit site code, or a site's rotating QR code. */
export type CheckInMethod = 'app' | 'site_code' | 'site_qr';

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
  /** How the worker proved it was them at check-in and check-out. */
  checkInAuth?: AttendanceAuth;
  checkOutAuth?: AttendanceAuth | null;
  corrected: boolean;
  synthetic: boolean;
  /** The site whose QR code was scanned at check-in, if any. */
  siteId?: string | null;
  siteName?: string | null;
}

/** "passkey": a passkey assertion with user verification, checked by the server. "session": the signed-in session only. */
export type AttendanceAuth = 'session' | 'passkey';

export interface PasskeyDTO {
  id: string;
  label: string;
  /** "multiDevice" passkeys sync between a person's devices; "singleDevice" ones stay on one device. */
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PasskeysResponse {
  /** False when this server has no WebAuthn relying party configured. */
  available: boolean;
  /** When true, check-in and check-out need a passkey (the worker has at least one). */
  required: boolean;
  items: PasskeyDTO[];
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

export interface SafetyRules {
  /** When true, self-verification by the resolving administrator is disallowed and requires an independent party. */
  requireIndependentVerification?: boolean;
  /** Overrides the industry's list of gear photo analysis expects everyone to wear. */
  requiredPpe?: PpeItem[];
}

export interface OrgSettings {
  pay: PayRules;
  fatigue: FatigueRules;
  attendance: AttendanceRules;
  safety?: SafetyRules;
}

export interface SiteCodeDTO {
  code: string;
  /** Last instant at which this code is accepted (UTC ISO). */
  validUntil: string;
  requireSiteCode: boolean;
}

/** The QR display for one site, as the employer console shows it. Times come from the server clock. */
export interface SiteQrStateDTO {
  site: SiteDTO;
  active: boolean;
  startedAt: string | null;
  /** Present only while the display is active. */
  token: string | null;
  issuedAt: string | null;
  /** When the display will show a new code. */
  rotatesAt: string | null;
  /** Last instant at which this code is accepted. */
  expiresAt: string | null;
  serverNow: string;
  rotateSeconds: number;
  ttlSeconds: number;
  /** Check-ins made by scanning this site's QR code today. */
  checkInsToday: number;
}

/** What a worker sees after scanning, before confirming the check-in. Nothing is recorded yet. */
export interface QrResolveDTO {
  siteId: string;
  siteName: string;
  siteAddress: string;
  expiresAt: string;
  /** True if this worker already used this exact code. */
  alreadyUsed: boolean;
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
  siteName?: string | null;
  /** What the reporter pointed out in the photos (see INSPECTION_CHECKS). */
  inspectionChecks?: string[];
  /** Photo metadata only; the image itself is fetched separately with access checks. */
  evidence?: EvidenceDTO[];
  closure?: ClosureDTO;
}

export type EvidenceStage = 'hazard' | 'remediation';
/** Advisory outcomes, most to least serious. None of them certifies that a place is safe. */
export type EvidenceOutcome = 'potential_hazard' | 'ppe_may_be_missing' | 'manual_inspection_required' | 'unable_to_determine' | 'no_visible_issue';

export interface EvidenceFinding {
  /** fire, electrical, machinery, structure, chemical, or a PPE item (helmet, vest, …). */
  kind: string;
  outcome: EvidenceOutcome;
  /** The provider's own labels and confidence (0–1) that raised the finding. */
  signals: { name: string; score: number }[];
}

export interface EvidenceAnalysisDTO {
  provider: string;
  outcome: EvidenceOutcome;
  findings: EvidenceFinding[];
  labels: { name: string; score: number }[];
  analyzedAt: string;
}

export interface EvidenceDTO {
  id: string;
  stage: EvidenceStage;
  mime: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  caption: string;
  /** "Reporter" or the administrator's name; never a confidential reporter's name. */
  uploadedBy: string;
  createdAt: string;
  analysisStatus: 'not_configured' | 'completed' | 'failed';
  analysis: EvidenceAnalysisDTO | null;
  reviewStatus: 'pending' | 'confirmed' | 'dismissed';
  reviewNote: string | null;
  reviewedAt: string | null;
}

export interface EvidenceVerificationDTO {
  evidenceId: string;
  /** The stored bytes still hash to the recorded SHA-256. */
  hashMatches: boolean;
  /** The seal over the evidence record checks out with the signing key it names. */
  sealValid: boolean;
  keyId: string;
  sha256: string;
  checkedAt: string;
}

/**
 * Two-key closure for reports with photos: the fix needs an after photo, and the outcome is
 * verified only once the reporter confirms it, or, if they do not answer in time, by an
 * administrator other than the one who resolved it.
 */
export interface ClosureDTO {
  policy: 'two_key' | 'standard';
  workerResponse: 'confirmed' | 'disputed' | null;
  workerResponseNote: string | null;
  workerResponseAt: string | null;
  /** When an independent administrator may verify without the reporter's answer (UTC ISO). */
  escalationAt: string | null;
  /** True once that time has passed (by the server's clock). */
  escalationOpen: boolean;
  remediationPhotos: number;
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
    basePayMinor?: { before: number; after: number };
    overtimePayMinor?: { before: number; after: number };
    hourlyRateMinor?: { before: number; after: number };
  };
}

export interface CanonicalReceiptData {
  shiftId: string;
  workerId: string;
  orgId: string;
  version: number;
  keyId?: string;
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
  keyId?: string;
  canonicalDigest: string;
  status: 'estimated' | 'finalized';
  data: CanonicalReceiptData;
  correctionReason: string | null;
  createdAt: string;
  createdBy: string | null;
  verified?: boolean;
  anchored?: boolean;
  checkpointId?: string | null;
}

// ---- Independent Proof Anchoring & Checkpoints ----

export interface ProofCheckpointDTO {
  id: string;
  orgId: string;
  sequence: number;
  merkleRoot: string;
  receiptCount: number;
  previousCheckpointRoot: string | null;
  keyId: string;
  signature: string;
  createdAt: string;
}

export interface MerkleAuditStepDTO {
  position: 'left' | 'right';
  hash: string;
}

export interface ReceiptInclusionProofDTO {
  receiptId: string;
  canonicalDigest: string;
  leafHash: string;
  leafIndex: number;
  checkpointId: string;
  checkpointSequence: number;
  merkleRoot: string;
  auditPath: MerkleAuditStepDTO[];
}

export interface IndependentVerificationBundle {
  version: '1.0';
  receipt: CanonicalReceiptData;
  canonicalDigest: string;
  leafHash: string;
  leafIndex: number;
  auditPath: MerkleAuditStepDTO[];
  checkpoint: ProofCheckpointDTO;
}

export type VerificationTrustStatus =
  | 'valid_and_anchored'
  | 'valid_unanchored'
  | 'unauthenticated_inclusion'
  | 'wrong_organization'
  | 'invalid_digest'
  | 'invalid_proof'
  | 'invalid_checkpoint_signature'
  | 'missing_checkpoint'
  | 'unknown_key'
  | 'broken_version_chain';

export interface ReceiptVerificationResponse {
  receipt: WorkReceiptDTO;
  verified: boolean;
  trustStatus: VerificationTrustStatus;
  checkpoint?: ProofCheckpointDTO | null;
  proof?: ReceiptInclusionProofDTO | null;
  independentBundle?: IndependentVerificationBundle | null;
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
  meanTimeToVerifyMinutes?: number | null;
  verificationRatePercent: number;
  reopenRatePercent: number;
  overdueFollowUps: number;
}

// ---- Sites & In-App Notifications (V4.0) ----

export interface SiteDTO {
  id: string;
  name: string;
  code: string;
  address: string;
  active: boolean;
  createdAt: string;
}

export type NotificationType = 'shift_correction' | 'payslip_issued' | 'safety_update' | 'safety_alert' | 'system';

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationsResponse {
  items: NotificationDTO[];
  unreadCount: number;
}

/** One report with photos, as listed in the console's inspection view. */
export interface InspectionDTO {
  report: SafetyReportDTO;
  hazardPhotos: number;
  remediationPhotos: number;
  /** The most serious advisory outcome across the report's analysed photos; null if none was analysed. */
  worstOutcome: EvidenceOutcome | null;
  analysedPhotos: number;
  /** Photos whose advisory result nobody has confirmed or dismissed yet. */
  pendingReviews: number;
  /** First hazard photo and latest photo of the fix, for the before/after thumbnails. */
  beforeId: string | null;
  afterId: string | null;
  closure: ClosureDTO;
}

// ---- Recorded wage payments and the possible pay shortfall indicator ----

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'upi', 'cheque', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentDTO {
  id: string;
  workerId: string;
  periodStart: string;
  periodEnd: string;
  /** Integer paise. Adjustments may be negative (a correction of an earlier entry). */
  amountMinor: number;
  kind: 'payment' | 'adjustment';
  method: PaymentMethod;
  paidOn: string;
  reference: string;
  note: string;
  recordedByName: string | null;
  createdAt: string;
  synthetic: boolean;
}

/**
 * none: no discrepancy identified. possible_shortfall: less was recorded than expected.
 * requires_review: a large gap, or nothing recorded at all. unavailable: the calculation cannot be made reliably.
 */
export type ShortfallStatus = 'no_discrepancy' | 'possible_shortfall' | 'requires_review' | 'unavailable';

export type ShortfallReason =
  | 'rate_missing'
  | 'calculation_failed'
  | 'nothing_due'
  | 'no_payment_recorded'
  | 'paid_in_full'
  | 'recorded_exceeds_expected'
  | 'small_shortfall'
  | 'large_shortfall'
  | 'open_shifts_excluded'
  | 'payments_outside_period';

export interface ShortfallResultDTO {
  status: ShortfallStatus;
  reasons: ShortfallReason[];
  /** Expected earnings from verified (closed) shifts at the configured rate; null when unavailable. */
  expected: {
    regularMinutes: number;
    overtimeMinutes: number;
    basePayMinor: number;
    overtimePayMinor: number;
    grossPayMinor: number;
    totalDeductionsMinor: number;
    netPayMinor: number;
  } | null;
  recordedMinor: number;
  outstandingMinor: number;
  overpaidMinor: number;
  paymentCount: number;
  /** Shortfalls at or above this share of expected pay (basis points) are marked for review. */
  reviewThresholdBp: number;
}

export interface PayCheckDTO {
  workerId: string;
  workerName: string;
  jobTitle: string;
  period: { from: string; to: string };
  currency: string;
  rate: { hourlyRateMinor: number; overtimeMultiplierBp: number; scheduledDailyMinutes: number; deductions: DeductionRule[] };
  shiftsCounted: number;
  openShiftsExcluded: number;
  result: ShortfallResultDTO;
  payments: PaymentDTO[];
  /** Recorded payments that cover dates outside this period; shown, not counted. */
  excludedPayments: PaymentDTO[];
  synthetic: boolean;
}

export interface PayCheckSummaryItem {
  workerId: string;
  workerName: string;
  jobTitle: string;
  team: string;
  status: ShortfallStatus;
  expectedNetMinor: number | null;
  recordedMinor: number;
  outstandingMinor: number;
  paymentCount: number;
}

export interface PayCheckSummaryDTO {
  period: { from: string; to: string };
  currency: string;
  counts: Record<ShortfallStatus, number>;
  items: PayCheckSummaryItem[];
  /** False when no payment has ever been recorded for this organisation. */
  paymentsRecorded: boolean;
}

// ---- Retention attention panel (rule-based, explainable; never a prediction) ----

export type AttentionLevel = 'low' | 'moderate' | 'high';
export type AttentionFactorKey = 'overtime' | 'hours_alerts' | 'attendance' | 'safety' | 'pay';
export type AttentionUnavailableKey = 'feedback' | 'wage_disputes' | 'pay';

export interface AttentionRecord {
  at: string;
  label: string;
  link: string | null;
}

export interface AttentionFactorDTO {
  key: AttentionFactorKey;
  label: string;
  points: number;
  maxPoints: number;
  observed: number;
  reason: string;
  followUp: string;
  records: AttentionRecord[];
}

export interface RetentionWorkerDTO {
  workerId: string;
  name: string;
  jobTitle: string;
  team: string;
  level: AttentionLevel;
  score: number;
  factors: AttentionFactorDTO[];
}

export interface RetentionPanelDTO {
  window: { from: string; to: string; days: number };
  thresholds: { moderate: number; high: number };
  counts: Record<AttentionLevel, number>;
  workers: RetentionWorkerDTO[];
  unavailable: { key: AttentionUnavailableKey; reason: string }[];
  disclaimer: string;
  synthetic: boolean;
}
