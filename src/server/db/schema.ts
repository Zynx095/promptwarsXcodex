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
  session_version INTEGER NOT NULL DEFAULT 0,
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
  -- How the worker proved it was them: the signed-in session alone, or a passkey checked by the server
  check_in_auth TEXT NOT NULL DEFAULT 'session' CHECK (check_in_auth IN ('session', 'passkey')),
  check_out_auth TEXT CHECK (check_out_auth IN ('session', 'passkey')),
  corrected INTEGER NOT NULL DEFAULT 0,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Set only when the worker checked in by scanning that site's rotating QR code (check_in_method is then 'site_code')
  site_id TEXT REFERENCES sites(id),
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
  status TEXT NOT NULL CHECK (status IN ('submitted', 'acknowledged', 'in_progress', 'resolved', 'follow_up_pending', 'outcome_verified', 'reopened')),
  assignee TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  action_taken TEXT,
  follow_up_date TEXT,
  verified_at TEXT,
  verified_by TEXT,
  verification_note TEXT,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  site_id TEXT REFERENCES sites(id),
  inspection_checks TEXT NOT NULL DEFAULT '[]',
  worker_response TEXT CHECK (worker_response IN ('confirmed', 'disputed')),
  worker_response_note TEXT,
  worker_response_at TEXT,
  client_request_id TEXT,
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
  key_id TEXT NOT NULL DEFAULT 'v1',
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
CREATE INDEX IF NOT EXISTS idx_receipts_org_shift ON work_receipts(org_id, shift_id, version);

CREATE TABLE IF NOT EXISTS receipt_checkpoints (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  sequence INTEGER NOT NULL,
  merkle_root TEXT NOT NULL,
  receipt_count INTEGER NOT NULL,
  previous_checkpoint_root TEXT,
  key_id TEXT NOT NULL DEFAULT 'chk_v1',
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (org_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_org_seq ON receipt_checkpoints(org_id, sequence);

CREATE TABLE IF NOT EXISTS receipt_checkpoint_entries (
  checkpoint_id TEXT NOT NULL REFERENCES receipt_checkpoints(id) ON DELETE CASCADE,
  receipt_id TEXT NOT NULL REFERENCES work_receipts(id) ON DELETE CASCADE,
  leaf_index INTEGER NOT NULL,
  leaf_hash TEXT NOT NULL,
  PRIMARY KEY (checkpoint_id, leaf_index),
  UNIQUE (receipt_id)
);
CREATE INDEX IF NOT EXISTS idx_chk_entries_receipt ON receipt_checkpoint_entries(receipt_id);
CREATE INDEX IF NOT EXISTS idx_reports_org_cat_status ON safety_reports(org_id, category, status);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (org_id, code)
);
CREATE INDEX IF NOT EXISTS idx_sites_org ON sites(org_id, active);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(org_id, created_at);

-- Safety photos. Bytes are stored after metadata removal; sha256 is of those exact bytes, and
-- seal is an HMAC-SHA256 (receipt signing key, key_id for rotation) over the canonical evidence
-- record. uploader_id is NULL when a confidential reporter uploads, so the photo never points
-- back to them. No original file name is kept. Advisory analysis and human review are separate
-- columns that may change; the photo, its hash and its seal may not (see triggers below).
CREATE TABLE IF NOT EXISTS report_evidence (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  report_id TEXT NOT NULL REFERENCES safety_reports(id),
  stage TEXT NOT NULL CHECK (stage IN ('hazard', 'remediation')),
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes BLOB NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  uploader_role TEXT NOT NULL CHECK (uploader_role IN ('reporter', 'admin')),
  uploader_id TEXT REFERENCES users(id),
  seal TEXT NOT NULL,
  seal_key_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  analysis_status TEXT NOT NULL DEFAULT 'not_configured' CHECK (analysis_status IN ('not_configured', 'completed', 'failed')),
  analysis_json TEXT,
  analysis_at TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'confirmed', 'dismissed')),
  review_note TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_report ON report_evidence(report_id, stage, created_at);
CREATE INDEX IF NOT EXISTS idx_evidence_org ON report_evidence(org_id, created_at);
CREATE TRIGGER IF NOT EXISTS report_evidence_immutable BEFORE UPDATE OF org_id, report_id, stage, mime, bytes, size_bytes, sha256, seal, seal_key_id, created_at, uploader_role, uploader_id ON report_evidence
BEGIN SELECT RAISE(ABORT, 'report_evidence photos are immutable'); END;

-- Passkeys (WebAuthn). Only the public key and its metadata are stored; the device keeps the
-- private key, and any fingerprint or face check happens on the device and never reaches us.
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id, revoked_at);

-- One-time WebAuthn challenges: bound to a user and a purpose, expire after five minutes and are
-- deleted when used, so an assertion can never be replayed.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'check-in', 'check-out')),
  challenge TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user ON webauthn_challenges(user_id, purpose);

-- Rotating site QR check-in. An administrator starts the QR display for a site; while it is active the
-- server issues short-lived signed tokens (one row per token, keyed by its random nonce). A token is
-- accepted only before expires_at by the server's clock, only while the display is active and never
-- twice by the same worker. The QR proves the code was seen recently, not where the phone was.
CREATE TABLE IF NOT EXISTS site_qr_sessions (
  site_id TEXT PRIMARY KEY REFERENCES sites(id),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  active INTEGER NOT NULL DEFAULT 0,
  started_by TEXT REFERENCES users(id),
  started_at TEXT,
  stopped_at TEXT
);
CREATE TABLE IF NOT EXISTS site_qr_tokens (
  nonce TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_qr_tokens_site ON site_qr_tokens(site_id, issued_at);
CREATE TABLE IF NOT EXISTS site_qr_uses (
  nonce TEXT NOT NULL REFERENCES site_qr_tokens(nonce),
  worker_id TEXT NOT NULL REFERENCES users(id),
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  used_at TEXT NOT NULL,
  PRIMARY KEY (nonce, worker_id)
);

-- Wage payments recorded by the employer (cash, bank transfer, UPI...). FairShift does not move money;
-- these rows only record what the employer says was paid, for a stated pay period. Corrections are new
-- 'adjustment' rows with a note, never edits.
CREATE TABLE IF NOT EXISTS wage_payments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  worker_id TEXT NOT NULL REFERENCES users(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor <> 0),
  kind TEXT NOT NULL CHECK (kind IN ('payment', 'adjustment')),
  method TEXT NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'upi', 'cheque', 'other')),
  paid_on TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  recorded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  CHECK (kind = 'adjustment' OR amount_minor > 0),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_wage_payments_worker ON wage_payments(worker_id, period_start);
CREATE INDEX IF NOT EXISTS idx_wage_payments_org ON wage_payments(org_id, period_start);
CREATE TRIGGER IF NOT EXISTS wage_payments_no_update BEFORE UPDATE ON wage_payments
BEGIN SELECT RAISE(ABORT, 'wage_payments is append-only'); END;
CREATE TRIGGER IF NOT EXISTS wage_payments_no_delete BEFORE DELETE ON wage_payments
BEGIN SELECT RAISE(ABORT, 'wage_payments is append-only'); END;

-- Append-only history: audit events, report status events and proof checkpoints can be added but
-- never edited or deleted through the application (or any other SQL run against this database).
CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS report_events_no_update BEFORE UPDATE ON report_events
BEGIN SELECT RAISE(ABORT, 'report_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS report_events_no_delete BEFORE DELETE ON report_events
BEGIN SELECT RAISE(ABORT, 'report_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS receipt_checkpoints_no_update BEFORE UPDATE ON receipt_checkpoints
BEGIN SELECT RAISE(ABORT, 'receipt_checkpoints is append-only'); END;
CREATE TRIGGER IF NOT EXISTS receipt_checkpoints_no_delete BEFORE DELETE ON receipt_checkpoints
BEGIN SELECT RAISE(ABORT, 'receipt_checkpoints is append-only'); END;
CREATE TRIGGER IF NOT EXISTS receipt_checkpoint_entries_no_update BEFORE UPDATE ON receipt_checkpoint_entries
BEGIN SELECT RAISE(ABORT, 'receipt_checkpoint_entries is append-only'); END;
CREATE TRIGGER IF NOT EXISTS receipt_checkpoint_entries_no_delete BEFORE DELETE ON receipt_checkpoint_entries
BEGIN SELECT RAISE(ABORT, 'receipt_checkpoint_entries is append-only'); END;
`;
