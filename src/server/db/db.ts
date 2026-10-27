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
}
