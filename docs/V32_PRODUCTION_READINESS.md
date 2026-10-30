# FairShift V3.2: Production Readiness, Storage Durability & Disaster Recovery

## 1. Executive Summary & Operational Context

FairShift runs as a single-container TypeScript service (Express 5 + Vite React) embedding SQLite (`node:sqlite`). In development and local demonstration environments, SQLite provides zero-configuration simplicity and deterministic seeding.

However, deploying SQLite directly into serverless container runtimes (such as Google Cloud Run or AWS ECS Fargate) introduces critical storage durability risks if misconfigured:

- **The Ephemeral `/tmp` Risk:** In Google Cloud Run, `/tmp` is an in-memory `tmpfs` RAM filesystem. When an instance recycles, scales down to zero, or crashes, the entire filesystem is wiped clean, resulting in **100% loss of workforce records, receipts, and audit logs**.

FairShift V3.2 resolves this by:

1. Re-targeting container storage to `/data/fairshift.db` with non-root ownership (`node:node`).
2. Providing verified Cloud Run persistent volume mount specifications.
3. Introducing zero-downtime point-in-time backup snapshots (`VACUUM INTO`) and integrity checks.

---

## 2. Cloud Run Persistent Volume Architecture

To ensure zero data loss on Google Cloud Run, `/data` must be mounted to a persistent storage backend using Cloud Run's native Volume Mount feature.

```
       ┌────────────────────────────────────────────────────────┐
       │                Google Cloud Run Service                │
       │                                                        │
       │   +------------------+         +------------------+   │
       │   │  Express Server  │ <─────> │ /data/fairshift.db│   │
       │   +------------------+         +------------------+   │
       └────────────────────────────────────────┬───────────────┘
                                                │
                                    Volume Mount (/data)
                                                │
                                                ▼
                         ┌──────────────────────────────────────────────┐
                         │   Persistent Storage Backend                 │
                         │   1. Cloud Storage FUSE Bucket (Recommended) │
                         │   2. Google Cloud Filestore (NFS)            │
                         │   3. Managed Database (Cloud SQL)            │
                         └──────────────────────────────────────────────┘
```

### Production Deployment Commands (Google Cloud Run with Cloud Storage Volume)

```bash
# 1. Create a dedicated Cloud Storage bucket in the same region
gcloud storage buckets create gs://fairshift-prod-data \
  --location=asia-south1 \
  --uniform-bucket-level-access

# 2. Build and deploy container with persistent volume mount
gcloud run deploy fairshift \
  --image=gcr.io/my-project/fairshift:v3.2 \
  --region=asia-south1 \
  --execution-environment=gen2 \
  --add-volume=name=db-storage,type=cloud-storage,bucket=fairshift-prod-data \
  --add-volume-mount=volume=db-storage,mount-path=/data \
  --set-env-vars="NODE_ENV=production,DATABASE_PATH=/data/fairshift.db,DEMO_MODE=false" \
  --set-secrets="SESSION_SECRET=fairshift-session-secret:latest,RECEIPT_SIGNING_SECRET=fairshift-receipt-key:latest,CHECKPOINT_SIGNING_SECRET=fairshift-checkpoint-key:latest,SIGNAL_PSEUDONYM_SECRET=fairshift-signal-key:latest" \
  --min-instances=1 \
  --max-instances=1 \
  --cpu=1 \
  --memory=1Gi
```

> [!IMPORTANT]
> Because SQLite is an embedded single-process database, Cloud Run `--max-instances` must be set to `1` when using SQLite over a network volume to prevent multi-instance write lock collisions. For horizontally scaled deployments across multiple instances, migrate to Cloud SQL for PostgreSQL or LiteFS.

---

## 3. Database Backup & Disaster Recovery Runbook

### 3.1 Point-in-Time Snapshot Mechanism

FairShift implements `backupDb(db, destinationPath)` using SQLite's native `VACUUM INTO`:

- **Non-blocking:** Readers and writers continue operating concurrently.
- **Transactionally Consistent:** Captures a clean point-in-time snapshot without partial WAL frames.
- **Compaction:** Defragments B-trees and removes unused pages, reducing backup transfer sizes.

### 3.2 Recovery Objectives

- **Recovery Point Objective (RPO):** $\le 1\text{ hour}$ (automated hourly cron triggering backup snapshot export to cold bucket).
- **Recovery Time Objective (RTO):** $\le 5\text{ minutes}$ (restoring database file from latest backup and restarting container).

### 3.3 Automated Integrity Verification

Before storing or restoring any backup:

```typescript
import { verifyDbIntegrity } from 'fairshift/server/db/db';

const result = verifyDbIntegrity(restoredDb);
if (!result.ok) {
  throw new Error(`Corrupted database backup: ${result.message}`);
}
```

---

## 4. Operational Monitoring & Alerting

### Key Health Metrics & Signals

| Operational Signal               | Detection Mechanism                             | Alert Threshold           | Action Required                                     |
| :------------------------------- | :---------------------------------------------- | :------------------------ | :-------------------------------------------------- |
| **Storage Availability**         | `GET /healthz`                                  | HTTP $\ne 200$            | Inspect volume mount and disk quota.                |
| **Receipt Verification Failure** | API log: `trustStatus !== 'valid_and_anchored'` | $> 0$ in production       | Investigate potential database tampering.           |
| **Authentication Brute Force**   | OTP / PIN attempt throttling counter            | $> 5$ failures / IP / 15m | Inspect IP for coordinated credential stuffing.     |
| **Checkpoint Generation Error**  | Checkpoint service exception                    | $> 0$ failures            | Check signing keys and database disk write lock.    |
| **Overdue Safety Follow-ups**    | `GET /api/admin/reports/accountability`         | `overdueFollowUps > 5`    | Notify site operations team of stalled inspections. |

### Privacy Logging Policy

All server logs adhere to strict PII redaction:

- **Never logged:** OTP codes, PIN hashes, session tokens, HMAC signing secrets, worker phone numbers, and raw confidential safety report text.
- **Allowed:** Opaque report IDs, HTTP status codes, latency in milliseconds, error category codes (`FORBIDDEN`, `CONFLICT`, `SELF_VERIFICATION_DISALLOWED`).
