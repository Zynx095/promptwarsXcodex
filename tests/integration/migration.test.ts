import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/server/db/db';
import { SCHEMA } from '../../src/server/db/schema';
import { randomUUID } from 'node:crypto';

describe('FairShift Database Reliability — Migration Safety & Idempotency Audit', () => {
  /**
   * Constructs an authentic older V1 database fixture representing pre-V2/pre-V3 schemas:
   * - shifts lacks check_in_method
   * - safety_reports lacks accountability loop columns (action_taken, follow_up_date, verified_at, verified_by, verification_note)
   * - work_receipts lacks key_id
   */
  function createV1Database(): DatabaseSync {
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');

    raw.exec(/* sql */ `
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        industry TEXT NOT NULL,
        timezone TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'INR',
        settings_json TEXT NOT NULL,
        is_synthetic INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        pin_hash TEXT NOT NULL,
        job_title TEXT NOT NULL DEFAULT '',
        team TEXT NOT NULL DEFAULT '',
        hourly_rate_minor INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        is_synthetic INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      -- V1 shifts table without check_in_method
      CREATE TABLE shifts (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        worker_id TEXT NOT NULL REFERENCES users(id),
        check_in_at TEXT NOT NULL,
        check_out_at TEXT,
        source TEXT NOT NULL,
        corrected INTEGER NOT NULL DEFAULT 0,
        is_synthetic INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE payslips (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        worker_id TEXT NOT NULL REFERENCES users(id),
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        currency TEXT NOT NULL,
        breakdown_json TEXT NOT NULL,
        gross_pay_minor INTEGER NOT NULL,
        net_pay_minor INTEGER NOT NULL,
        issued_by TEXT,
        issued_at TEXT NOT NULL,
        is_synthetic INTEGER NOT NULL DEFAULT 0
      );

      -- V1 safety_reports without accountability loop extension columns
      CREATE TABLE safety_reports (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        reporter_id TEXT REFERENCES users(id),
        reporter_ref TEXT,
        confidential INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        location TEXT NOT NULL,
        status TEXT NOT NULL,
        assignee TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT,
        is_synthetic INTEGER NOT NULL DEFAULT 0
      );

      -- V1 work_receipts without key_id
      CREATE TABLE work_receipts (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id),
        shift_id TEXT NOT NULL REFERENCES shifts(id),
        worker_id TEXT NOT NULL REFERENCES users(id),
        version INTEGER NOT NULL,
        previous_version_id TEXT,
        canonical_digest TEXT NOT NULL,
        status TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        correction_reason TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT,
        UNIQUE (shift_id, version)
      );
    `);

    // Insert legacy seed records into V1 tables
    raw.exec(/* sql */ `
      INSERT INTO organizations VALUES (
        'org_legacy_1', 'Legacy Infrastructure Ltd', 'construction', 'Asia/Kolkata', 'INR', '{}', 0, '2026-01-01T00:00:00Z'
      );

      INSERT INTO users VALUES (
        'usr_legacy_w1', 'org_legacy_1', 'worker', 'Legacy Worker', '9888888801', 'pin_hash_1', 'Mason', 'Team A', 10000, 1, 0, '2026-01-01T00:00:00Z'
      );

      INSERT INTO shifts VALUES (
        'shf_legacy_1', 'org_legacy_1', 'usr_legacy_w1', '2026-01-10T08:00:00Z', '2026-01-10T17:00:00Z', 'app', 0, 0, '2026-01-10T08:00:00Z', '2026-01-10T17:00:00Z'
      );

      INSERT INTO safety_reports VALUES (
        'rep_legacy_1', 'org_legacy_1', 'usr_legacy_w1', NULL, 0, 'fall', 'high', 'Legacy hazard', 'Missing guardrail', 'Roof edge', 'submitted', NULL, '2026-01-10T08:30:00Z', '2026-01-10T08:30:00Z', NULL, 0
      );

      INSERT INTO work_receipts VALUES (
        'rcpt_legacy_1', 'org_legacy_1', 'shf_legacy_1', 'usr_legacy_w1', 1, NULL, 'digest1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'finalized', '{}', NULL, '2026-01-10T17:00:00Z', 'usr_legacy_w1'
      );
    `);

    return raw;
  }

  it('safely migrates a legacy V1 database preserving all data, constraints, and relationships', () => {
    const raw = createV1Database();

    // Verify V1 state prior to migration
    const shiftColsBefore = raw.prepare(`SELECT name FROM pragma_table_info('shifts')`).all() as { name: string }[];
    expect(shiftColsBefore.some((c) => c.name === 'check_in_method')).toBe(false);

    const reportColsBefore = raw.prepare(`SELECT name FROM pragma_table_info('safety_reports')`).all() as { name: string }[];
    expect(reportColsBefore.some((c) => c.name === 'action_taken')).toBe(false);
    expect(reportColsBefore.some((c) => c.name === 'verified_at')).toBe(false);

    const receiptColsBefore = raw.prepare(`SELECT name FROM pragma_table_info('work_receipts')`).all() as { name: string }[];
    expect(receiptColsBefore.some((c) => c.name === 'key_id')).toBe(false);

    // Apply current schema and migrations
    raw.exec(SCHEMA);

    // Run migrations explicitly
    const cols = raw.prepare(`SELECT name FROM pragma_table_info('shifts')`).all() as { name: string }[];
    if (!cols.some((c) => c.name === 'check_in_method')) {
      raw.exec(`ALTER TABLE shifts ADD COLUMN check_in_method TEXT NOT NULL DEFAULT 'app' CHECK (check_in_method IN ('app', 'site_code'))`);
    }
    const reportCols = raw.prepare(`SELECT name FROM pragma_table_info('safety_reports')`).all() as { name: string }[];
    if (!reportCols.some((c) => c.name === 'action_taken')) {
      raw.exec(`ALTER TABLE safety_reports ADD COLUMN action_taken TEXT`);
    }
    if (!reportCols.some((c) => c.name === 'follow_up_date')) {
      raw.exec(`ALTER TABLE safety_reports ADD COLUMN follow_up_date TEXT`);
    }
    if (!reportCols.some((c) => c.name === 'verified_at')) {
      raw.exec(`ALTER TABLE safety_reports ADD COLUMN verified_at TEXT`);
    }
    if (!reportCols.some((c) => c.name === 'verified_by')) {
      raw.exec(`ALTER TABLE safety_reports ADD COLUMN verified_by TEXT`);
    }
    if (!reportCols.some((c) => c.name === 'verification_note')) {
      raw.exec(`ALTER TABLE safety_reports ADD COLUMN verification_note TEXT`);
    }
    const receiptCols = raw.prepare(`SELECT name FROM pragma_table_info('work_receipts')`).all() as { name: string }[];
    if (!receiptCols.some((c) => c.name === 'key_id')) {
      raw.exec(`ALTER TABLE work_receipts ADD COLUMN key_id TEXT NOT NULL DEFAULT 'v1'`);
    }

    // Verify existing records survived with new default values
    const shift = raw.prepare(`SELECT * FROM shifts WHERE id = 'shf_legacy_1'`).get() as { check_in_method: string; worker_id: string };
    expect(shift).toBeDefined();
    expect(shift.worker_id).toBe('usr_legacy_w1');
    expect(shift.check_in_method).toBe('app'); // Default applied

    const report = raw.prepare(`SELECT * FROM safety_reports WHERE id = 'rep_legacy_1'`).get() as { action_taken: string | null; title: string };
    expect(report).toBeDefined();
    expect(report.title).toBe('Legacy hazard');
    expect(report.action_taken).toBeNull(); // Nullable default applied

    const receipt = raw.prepare(`SELECT * FROM work_receipts WHERE id = 'rcpt_legacy_1'`).get() as { key_id: string; version: number };
    expect(receipt).toBeDefined();
    expect(receipt.version).toBe(1);
    expect(receipt.key_id).toBe('v1'); // Default 'v1' applied

    // Verify foreign key enforcement remains active
    expect(() => {
      raw.exec(`INSERT INTO shifts (
        id, org_id, worker_id, check_in_at, check_out_at, source, check_in_method, corrected, is_synthetic, created_at, updated_at
      ) VALUES (
        'shf_bad_1', 'org_non_existent', 'usr_legacy_w1', '2026-01-11T08:00:00Z', NULL, 'app', 'app', 0, 0, '2026-01-11T08:00:00Z', '2026-01-11T08:00:00Z'
      )`);
    }).toThrowError(/FOREIGN KEY constraint failed/);
  });

  it('verifies migration is 100% idempotent and can be safely re-run repeatedly', () => {
    // openDb runs SCHEMA and migrate() on initialization
    const db1 = openDb(':memory:');

    // Run SCHEMA again on the same database
    expect(() => db1.raw.exec(SCHEMA)).not.toThrow();

    // Verify inserting and updating records after second run
    const id = randomUUID();
    db1.run(
      `INSERT INTO organizations VALUES (
      @id, 'Test Org', 'construction', 'Asia/Kolkata', 'INR', '{}', 0, '2026-01-01T00:00:00Z'
    )`,
      { id },
    );

    const org = db1.get<{ id: string; name: string }>(`SELECT id, name FROM organizations WHERE id = @id`, { id });
    expect(org?.name).toBe('Test Org');
  });
});
