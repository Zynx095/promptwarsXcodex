// Database schema. Timestamps are UTC ISO-8601 text; money is integer minor units.
// Every tenant table carries org_id, and every query filters on it.
export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT NOT NULL CHECK (industry IN ('construction', 'education')),
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  settings_json TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL CHECK (role IN ('worker', 'admin')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  job_title TEXT NOT NULL DEFAULT '',
  team TEXT NOT NULL DEFAULT '',
  hourly_rate_minor INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate_minor >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id, role);

CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  worker_id TEXT NOT NULL REFERENCES users(id),
  check_in_at TEXT NOT NULL,
  check_out_at TEXT,
  source TEXT NOT NULL CHECK (source IN ('app', 'seed', 'correction')),
  check_in_method TEXT NOT NULL DEFAULT 'app' CHECK (check_in_method IN ('app', 'site_code')),
  corrected INTEGER NOT NULL DEFAULT 0,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (check_out_at IS NULL OR check_out_at > check_in_at)
);
CREATE INDEX IF NOT EXISTS idx_shifts_org_time ON shifts(org_id, check_in_at);
CREATE INDEX IF NOT EXISTS idx_shifts_worker_time ON shifts(worker_id, check_in_at);
-- At most one open shift per worker: the database itself rejects duplicate check-ins.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_open ON shifts(worker_id) WHERE check_out_at IS NULL;

CREATE TABLE IF NOT EXISTS payslips (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  worker_id TEXT NOT NULL REFERENCES users(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  currency TEXT NOT NULL,
  breakdown_json TEXT NOT NULL,
  gross_pay_minor INTEGER NOT NULL CHECK (gross_pay_minor >= 0),
  net_pay_minor INTEGER NOT NULL CHECK (net_pay_minor >= 0),
  issued_by TEXT REFERENCES users(id),
  issued_at TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  UNIQUE (worker_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_payslips_org ON payslips(org_id, issued_at);

CREATE TABLE IF NOT EXISTS safety_reports (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  -- reporter_id is NULL for confidential reports; reporter_ref is a keyed hash that only
  -- lets the reporter find their own report.
  reporter_id TEXT REFERENCES users(id),
  reporter_ref TEXT,
  confidential INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'acknowledged', 'in_progress', 'resolved', 'reopened')),
  assignee TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  CHECK ((confidential = 1 AND reporter_id IS NULL AND reporter_ref IS NOT NULL) OR (confidential = 0 AND reporter_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_reports_org ON safety_reports(org_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON safety_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_ref ON safety_reports(reporter_ref);

CREATE TABLE IF NOT EXISTS report_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  report_id TEXT NOT NULL REFERENCES safety_reports(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id TEXT REFERENCES users(id),
  actor_role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_events ON report_events(report_id, created_at);
CREATE INDEX IF NOT EXISTS idx_report_events_org ON report_events(org_id, created_at);

-- Feedback deliberately stores no user reference and only the submission date.
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  category TEXT NOT NULL,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'actioned', 'hidden')),
  submitted_on TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_feedback_org ON feedback(org_id, submitted_on);

CREATE TABLE IF NOT EXISTS fatigue_alerts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  worker_id TEXT NOT NULL REFERENCES users(id),
  rule TEXT NOT NULL,
  window_key TEXT NOT NULL,
  observed_value INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  acknowledged_by TEXT REFERENCES users(id),
  UNIQUE (worker_id, rule, window_key)
);
CREATE INDEX IF NOT EXISTS idx_alerts_org ON fatigue_alerts(org_id, status, created_at);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  worker_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('skill', 'training', 'certification')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  issued_on TEXT,
  expires_on TEXT,
  verification TEXT NOT NULL CHECK (verification IN ('self_reported', 'employer_verified')),
  verified_by TEXT REFERENCES users(id),
  added_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_skills_worker ON skills(worker_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_events(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github', 'phone_otp', 'phone_pin')),
  provider_user_id TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  last_sign_in_at TEXT,
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_user ON auth_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_identities_email ON auth_identities(email);

CREATE TABLE IF NOT EXISTS phone_verifications (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phone_verifications ON phone_verifications(phone, expires_at);

CREATE TABLE IF NOT EXISTS work_receipts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  previous_version_id TEXT REFERENCES work_receipts(id),
  canonical_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('estimated', 'finalized')),
  receipt_json TEXT NOT NULL,
  correction_reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  UNIQUE (shift_id, version)
);
CREATE INDEX IF NOT EXISTS idx_receipts_shift ON work_receipts(shift_id, version);
CREATE INDEX IF NOT EXISTS idx_receipts_worker ON work_receipts(worker_id, created_at);
CREATE INDEX IF NOT EXISTS idx_receipts_org ON work_receipts(org_id, created_at);
`;
