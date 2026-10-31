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
  /** How the worker proved it was them at check-in and check-out. */
  checkInAuth?: AttendanceAuth;
  checkOutAuth?: AttendanceAuth | null;
  corrected: boolean;
  synthetic: boolean;
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
