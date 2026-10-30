# FairShift V4.0 — Deployment & Operations Runbook

This guide covers deploying, operating, backing up, and maintaining FairShift V4.0 in containerized production environments, with specific instructions for **Google Cloud Run** and **Docker Engine**.

---

## 1. Container Architecture & Storage Model

FairShift runs as a single cohesive full-stack Node.js 22 LTS container serving both the static Vite frontend and the high-performance Express/SQLite backend.

### Storage Architecture

- **Database Engine**: Node 22 built-in SQLite (`DatabaseSync`) in Write-Ahead Log (`WAL`) mode.
- **Persistent Volume Mount**: The default database path is `/data/fairshift.db`.
- **User Permissions**: Hardened to run as non-root user `node` (`UID 1000:GID 1000`). The `/data` directory must be owned by `node:node`.

---

## 2. Google Cloud Run Deployment

Google Cloud Run provides serverless container execution with second-generation Cloud Storage volume mounts.

### Step 1: Create a Cloud Storage Bucket for SQLite Persistence

```bash
gcloud storage buckets create gs://fairshift-data-prod \
  --location=asia-south1 \
  --uniform-bucket-level-access
```

### Step 2: Build and Push Container Image to Artifact Registry

```bash
# Configure Docker authentication
gcloud auth configure-docker asia-south1-docker.pkg.dev

# Build multi-stage hardened image
docker build -t asia-south1-docker.pkg.dev/PROJECT_ID/fairshift-repo/fairshift:v4.0.0 .

# Push image
docker push asia-south1-docker.pkg.dev/PROJECT_ID/fairshift-repo/fairshift:v4.0.0
```

### Step 3: Deploy to Cloud Run with Persistent Volume Mount

```bash
gcloud run deploy fairshift-prod \
  --image=asia-south1-docker.pkg.dev/PROJECT_ID/fairshift-repo/fairshift:v4.0.0 \
  --region=asia-south1 \
  --platform=managed \
  --execution-environment=gen2 \
  --add-volume=name=db-storage,type=cloud-storage,bucket=fairshift-data-prod \
  --add-volume-mount=volume=db-storage,mount-path=/data \
  --set-env-vars=NODE_ENV=production,DATABASE_PATH=/data/fairshift.db \
  --set-secrets=SESSION_SECRET=fairshift-session-secret:latest,\
RECEIPT_SIGNING_SECRET=fairshift-receipt-key:latest,\
CHECKPOINT_SIGNING_SECRET=fairshift-checkpoint-key:latest,\
SIGNAL_PSEUDONYM_SECRET=fairshift-signal-key:latest \
  --allow-unauthenticated \
  --cpu=1 \
  --memory=512Mi \
  --min-instances=1 \
  --max-instances=1
```

> [!IMPORTANT]
> **Single-Writer Constraint**: SQLite in WAL mode requires single-writer semantics. Always configure `--min-instances=1 --max-instances=1` on Cloud Run to prevent split-brain write conflicts across multiple container instances.

> [!WARNING]
> **Cloud Storage FUSE is not a safe home for a live SQLite database.** A Cloud Storage volume is an object store exposed through FUSE: it provides no file locking and no shared memory for SQLite's `-wal`/`-shm` files, and writes are uploaded as whole objects. Even with one instance, a revision rollout briefly runs the old and new instance together, and a crash mid-upload can leave a stale or torn file. Treat the Step 3 command as **unverified** (it was never deployed during the audit). Safer options, in order of effort:
>
> 1. **Demo:** omit the volume, keep `DEMO_MODE=true`, and accept that data is reseeded on each cold start (`docs/DEPLOYMENT.md`).
> 2. **Small pilot:** keep the database on the container's local disk and copy snapshots made with `backupDb` (`VACUUM INTO`) to Cloud Storage on a schedule, restoring the newest snapshot at start-up; or mount a Filestore (NFS) volume, which supports locking.
> 3. **Production:** move to Cloud SQL for PostgreSQL. This is a separate migration and was not started.
>
> Also set `RECEIPT_SIGNING_SECRET`, `CHECKPOINT_SIGNING_SECRET` and `SIGNAL_PSEUDONYM_SECRET` explicitly, as above. When they are unset they fall back to `SESSION_SECRET`, and with `DEMO_MODE=true` and no `SESSION_SECRET` that is an ephemeral random value: every receipt and checkpoint in a persisted database then fails verification after a restart, and confidential reporters can no longer find their own reports.

---

## 3. Local / Self-Hosted Docker Deployment

For self-hosted Linux virtual machines or on-premise infrastructure using Docker Compose:

### Sample `docker-compose.yml`

```yaml
version: '3.8'

services:
  fairshift:
    image: fairshift:v4.0.0
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_PATH=/data/fairshift.db
      - SESSION_SECRET=CHANGE_ME_64_CHAR_HEX_SESSION_SECRET
      - RECEIPT_SIGNING_SECRET=CHANGE_ME_64_CHAR_HEX_RECEIPT_SECRET
      - CHECKPOINT_SIGNING_SECRET=CHANGE_ME_64_CHAR_HEX_CHECKPOINT_SECRET
      - SIGNAL_PSEUDONYM_SECRET=CHANGE_ME_64_CHAR_HEX_SIGNAL_SECRET
      - ACTIVE_RECEIPT_KEY_ID=v1
      - ACTIVE_CHECKPOINT_KEY_ID=chk_v1
    volumes:
      - fairshift_data:/data
    user: '1000:1000'
    healthcheck:
      test: ['CMD', 'node', '-e', "fetch('http://localhost:3000/healthz').then(r => r.ok ? process.exit(0) : process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  fairshift_data:
    driver: local
```

---

## 4. Database Backup & Disaster Recovery Procedures

FairShift utilizes SQLite's non-blocking `VACUUM INTO` command for atomic point-in-time snapshots without pausing live shift check-ins or writes.

### Performing an On-Demand Backup

Run inside the container or via scheduled cron:

```bash
# Execute backup snapshot inside live container
docker exec -t fairshift-prod node -e "
  const { openDb, backupDb, verifyDbIntegrity } = require('./dist/server/db/db.js');
  const db = openDb(process.env.DATABASE_PATH || '/data/fairshift.db');
  const backupFile = '/data/backups/fairshift_' + new Date().toISOString().replace(/[:.]/g, '-') + '.db';
  backupDb(db, backupFile);
  const backupDbInstance = openDb(backupFile);
  const check = verifyDbIntegrity(backupDbInstance);
  console.log('Backup created:', backupFile, 'Integrity:', check.message);
  db.close();
  backupDbInstance.close();
"
```

### Verifying Backup Integrity

To verify any offline backup file before restoring:

```bash
sqlite3 /data/backups/fairshift_snapshot.db "PRAGMA integrity_check;"
# Output must be: ok
```

### Restoring from Backup

1. Stop the application container: `docker stop fairshift-prod`
2. Archive the current corrupted database:
   ```bash
   mv /data/fairshift.db /data/fairshift.db.corrupted.$(date +%s)
   ```
3. Copy the verified backup into place:
   ```bash
   cp /data/backups/fairshift_snapshot.db /data/fairshift.db
   chown 1000:1000 /data/fairshift.db
   ```
4. Restart container: `docker start fairshift-prod`
5. Verify health: `curl -f http://localhost:3000/healthz`

---

## 5. Security & Operational Runbook

### Handling Key Rotation

When rotating receipt or checkpoint keys:

1. Generate new 64-character secrets.
2. In Secret Manager or environment variables, keep historical keys in `RECEIPT_SIGNING_KEYS` JSON dictionary:
   ```bash
   RECEIPT_SIGNING_KEYS='{"v1":"old_key_secret","v2":"new_key_secret"}'
   ACTIVE_RECEIPT_KEY_ID=v2
   ```
3. Existing receipts signed under `v1` continue to verify seamlessly; new receipts are signed under `v2`.

### Monitoring Metrics & Health Checks

- **Health Endpoint**: `GET /healthz` (Returns HTTP 200 `{"status":"ok"}` after executing an active SQLite ping).
- **Audit Logs**: All sensitive operations are queryable by administrators at `/api/admin/audit` and `/admin/audit`.
