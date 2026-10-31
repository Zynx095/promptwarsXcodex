// Thin wrapper over Node's built-in SQLite driver: cached prepared statements, named
// parameters only (no string-built SQL), and transactions.
import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA } from './schema';

export type Params = Record<string, SQLInputValue | boolean | undefined>;

function bind(params: Params = {}): Record<string, SQLInputValue> {
  const out: Record<string, SQLInputValue> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return out;
}

export class Db {
  private statements = new Map<string, StatementSync>();
  private depth = 0;

  constructor(readonly raw: DatabaseSync) {}

  private stmt(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  get<T>(sql: string, params?: Params): T | undefined {
    return this.stmt(sql).get(bind(params)) as T | undefined;
  }

  all<T>(sql: string, params?: Params): T[] {
    return this.stmt(sql).all(bind(params)) as T[];
  }

  run(sql: string, params?: Params): number {
    return Number(this.stmt(sql).run(bind(params)).changes);
  }

  /** Runs fn atomically. Nested calls use savepoints. */
  tx<T>(fn: () => T): T {
    const sp = `sp${this.depth}`;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return result;
    } catch (err) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    }
  }

  close(): void {
    this.raw.close();
  }
}

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec(SCHEMA);
  migrate(raw);
  return new Db(raw);
}

/** Additive migrations for databases created by earlier versions (never destructive). */
function migrate(raw: DatabaseSync): void {
  const cols = raw.prepare(`SELECT name FROM pragma_table_info('shifts')`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'check_in_method')) {
    raw.exec(`ALTER TABLE shifts ADD COLUMN check_in_method TEXT NOT NULL DEFAULT 'app' CHECK (check_in_method IN ('app', 'site_code'))`);
  }
  if (!cols.some((c) => c.name === 'check_in_auth')) {
    raw.exec(`ALTER TABLE shifts ADD COLUMN check_in_auth TEXT NOT NULL DEFAULT 'session' CHECK (check_in_auth IN ('session', 'passkey'))`);
    raw.exec(`ALTER TABLE shifts ADD COLUMN check_out_auth TEXT CHECK (check_out_auth IN ('session', 'passkey'))`);
  }
  if (!cols.some((c) => c.name === 'site_id')) {
    raw.exec(`ALTER TABLE shifts ADD COLUMN site_id TEXT REFERENCES sites(id)`);
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
  if (!reportCols.some((c) => c.name === 'site_id')) {
    raw.exec(`ALTER TABLE safety_reports ADD COLUMN site_id TEXT REFERENCES sites(id)`);
  }
  if (!reportCols.some((c) => c.name === 'inspection_checks')) {
    raw.exec(`ALTER TABLE safety_reports ADD COLUMN inspection_checks TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!reportCols.some((c) => c.name === 'worker_response')) {
    raw.exec(`ALTER TABLE safety_reports ADD COLUMN worker_response TEXT CHECK (worker_response IN ('confirmed', 'disputed'))`);
    raw.exec(`ALTER TABLE safety_reports ADD COLUMN worker_response_note TEXT`);
    raw.exec(`ALTER TABLE safety_reports ADD COLUMN worker_response_at TEXT`);
  }
  // A random ID the phone attaches to a report it may send more than once (offline retries)
  if (!reportCols.some((c) => c.name === 'client_request_id')) {
    raw.exec(`ALTER TABLE safety_reports ADD COLUMN client_request_id TEXT`);
  }
  raw.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_client_request ON safety_reports(org_id, client_request_id) WHERE client_request_id IS NOT NULL`);
  const userCols = raw.prepare(`SELECT name FROM pragma_table_info('users')`).all() as { name: string }[];
  if (!userCols.some((c) => c.name === 'session_version')) {
    raw.exec(`ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`);
  }
  const receiptCols = raw.prepare(`SELECT name FROM pragma_table_info('work_receipts')`).all() as { name: string }[];
  if (!receiptCols.some((c) => c.name === 'key_id')) {
    raw.exec(`ALTER TABLE work_receipts ADD COLUMN key_id TEXT NOT NULL DEFAULT 'v1'`);
  }
  const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[];
  if (!tables.some((t) => t.name === 'receipt_checkpoints')) {
    raw.exec(`
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
    `);
  }
  if (!tables.some((t) => t.name === 'receipt_checkpoint_entries')) {
    raw.exec(`
      CREATE TABLE IF NOT EXISTS receipt_checkpoint_entries (
        checkpoint_id TEXT NOT NULL REFERENCES receipt_checkpoints(id) ON DELETE CASCADE,
        receipt_id TEXT NOT NULL REFERENCES work_receipts(id) ON DELETE CASCADE,
        leaf_index INTEGER NOT NULL,
        leaf_hash TEXT NOT NULL,
        PRIMARY KEY (checkpoint_id, leaf_index),
        UNIQUE (receipt_id)
      );
      CREATE INDEX IF NOT EXISTS idx_chk_entries_receipt ON receipt_checkpoint_entries(receipt_id);
    `);
  }
  if (!tables.some((t) => t.name === 'sites')) {
    raw.exec(`
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
    `);
  }
  if (!tables.some((t) => t.name === 'notifications')) {
    raw.exec(`
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
    `);
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}

/**
 * Creates an atomic point-in-time backup snapshot of a live SQLite database
 * using SQLite's built-in VACUUM INTO command without exclusive locks.
 */
export function backupDb(db: Db, destinationPath: string): void {
  mkdirSync(dirname(destinationPath), { recursive: true });
  const escapedPath = destinationPath.replace(/'/g, "''");
  db.raw.exec(`VACUUM INTO '${escapedPath}'`);
}

/**
 * Runs PRAGMA integrity_check to verify that a database file is structurally sound and uncorrupted.
 */
export function verifyDbIntegrity(db: Db): { ok: boolean; message: string } {
  const row = db.raw.prepare(`PRAGMA integrity_check`).get() as { integrity_check: string } | undefined;
  const result = row?.integrity_check ?? 'unknown';
  return { ok: result === 'ok', message: result };
}
