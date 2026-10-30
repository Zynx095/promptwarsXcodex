# FairShift V3.1 — Database Reliability & Operational Architecture Report

## 1. Database Architecture & Concurrency Analysis

FairShift uses Node.js 22 built-in SQLite (`node:sqlite DatabaseSync`) with WAL (Write-Ahead Logging) mode and busy timeout handling:

- **Connection Mode:** Synchronous SQLite engine wrapped in `src/server/db/db.ts`.
- **WAL Mode:** Enabled in file-based databases (`PRAGMA journal_mode = WAL;`) allowing concurrent readers without blocking writers.
- **Foreign Keys:** Strictly enforced (`PRAGMA foreign_keys = ON;`).
- **Busy Timeout:** Configured to 5000ms (`PRAGMA busy_timeout = 5000;`) to handle lock contention gracefully.
- **Parameterized Queries:** Enforced across 100% of queries via named parameters (`bind(params)`), completely preventing SQL injection.

---

## 2. Migration Safety & Idempotency Evidence

### 2.1 Additive Migration Architecture

FairShift follows a strict non-destructive additive migration pattern:

- Existing tables and columns are never dropped or destructively renamed.
- Schema additions use `ALTER TABLE ADD COLUMN` with safe default values.
- Idempotency checks inspect table schemas via `pragma_table_info` before executing DDL.

### 2.2 Migrations Verified Against Legacy V1 Fixture

In `tests/integration/migration.test.ts`, an older V1 database fixture was constructed with legacy schemas:

1. `shifts` lacking `check_in_method` column.
2. `safety_reports` lacking accountability extension columns (`action_taken`, `follow_up_date`, `verified_at`, `verified_by`, `verification_note`).
3. `work_receipts` lacking `key_id` column.

**Results of Migration Execution:**

- All legacy records survived without corruption.
- Foreign key constraints remained intact and enforced.
- New columns populated with expected defaults (`check_in_method = 'app'`, `key_id = 'v1'`).
- Idempotent re-execution caused zero errors or duplicate column definitions.

---

## 3. Transaction Atomicity & Concurrency Controls

### 3.1 Multi-Step Atomic Operations

All multi-step state modifications are wrapped in database transactions (`ctx.db.tx(() => ...)`):

1. **Check-out & Receipt Sealing:** Updating shift `check_out_at`, calculating fatigue alerts, generating initial work receipt, and logging audit events occur within a single atomic transaction.
2. **Shift Correction:** Validating overlapping shifts, updating shift times, generating a versioned work receipt, logging audit history with correction reason, and recalculating fatigue alerts execute atomically.
3. **Payslip Issuance:** Validating open shifts, inserting payslip records, logging audit events, and finalizing covered work receipts occur atomically.
4. **Safety Report Transitions:** Validating allowed transitions, updating status and outcome fields, inserting report history events, and logging audit records are atomic.

### 3.2 Optimistic Concurrency Control

Concurrent updates to safety reports are protected via optimistic locking:

```sql
UPDATE safety_reports SET status = @to, ...
WHERE id = @id AND org_id = @orgId AND status = @from
```

If another administrator modified the report status between the read and write phases, the update affects 0 rows, and the system throws `DomainError('CONFLICT', 'This report was changed by someone else. Reload and try again.')`.

---

## 4. Cloud Run & Ephemeral Storage Architecture Review

### 4.1 Ephemeral Container Filesystem Implications

Google Cloud Run instances have ephemeral in-memory/scratch disk storage:

- **Container Restarts:** When Cloud Run scales down to zero or deploys a new revision, local disk contents are discarded.
- **Multi-Instance Scaling:** If traffic causes multiple container instances to run simultaneously, each instance has its own local SQLite file. Writes to Instance A are invisible to Instance B, causing database split-brain.
- **Current Status:** In demo mode or single-container instances with persistent volume mounts (e.g. Cloud Storage FUSE or Cloud Run Network File System / Filestore), SQLite can persist. However, multi-instance horizontal autoscaling requires a client-server relational database.

### 4.2 Recommended Managed Database Migration Path

For enterprise multi-region production deployments:

1. **Target Engine:** Google Cloud SQL for PostgreSQL 16 (or Supabase / Neon).
2. **Schema Mapping:**
   - SQLite `INTEGER (0/1)` $\rightarrow$ PostgreSQL `BOOLEAN`.
   - SQLite `TEXT` (ISO-8601) $\rightarrow$ PostgreSQL `TIMESTAMPTZ`.
   - SQLite `TEXT` (JSON) $\rightarrow$ PostgreSQL `JSONB`.
   - SQLite partial index (`WHERE check_out_at IS NULL`) $\rightarrow$ PostgreSQL partial index `CREATE UNIQUE INDEX uq_shifts_open ON shifts(worker_id) WHERE check_out_at IS NULL;`.
3. **Repository Layer:** Because all database access is encapsulated behind clean repository functions (`src/server/repositories/`), migrating the underlying driver requires changing only `src/server/db/db.ts` without modifying domain logic or API routes.
