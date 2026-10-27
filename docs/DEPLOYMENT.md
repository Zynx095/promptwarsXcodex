# Deploying FairShift

FairShift is a single container: the Node.js server listens on `$PORT` (Cloud Run sets it, default 8080), serves the API under `/api`, the built web client for every other path, and a health check at `/healthz`.

## Prerequisites

- A Google Cloud project with billing enabled.
- The `gcloud` CLI, authenticated (`gcloud auth login`) with a default project (`gcloud config set project YOUR_PROJECT_ID`).
- These APIs enabled: Cloud Run, Cloud Build, Artifact Registry, Secret Manager:
  ```bash
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
  ```

No other external services or credentials are required.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | Set by Cloud Run | HTTP port. |
| `NODE_ENV` | Set in the image (`production`) | Enables `Secure` cookies, CSP/HSTS headers and static file serving. |
| `SESSION_SECRET` | Yes for real use | At least 32 random characters. Signs session cookies and confidential-report references. Store it in Secret Manager. If missing while `DEMO_MODE=true`, an ephemeral secret is generated and sessions end on restart. If missing with demo mode off, the server refuses to start. |
| `DATABASE_PATH` | No | SQLite file path. The image default is `/tmp/fairshift/fairshift.db`. |
| `DEMO_MODE` | No | `true` seeds synthetic data into an empty database and enables the demo-account list on the sign-in page. |

## Deploy (demo configuration)

```bash
# 1. Create the session secret once.
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" | \
  gcloud secrets create fairshift-session-secret --data-file=-

# 2. Let the Cloud Run runtime service account read it (default compute service account shown).
PROJECT_NUMBER=$(gcloud projects describe "$(gcloud config get-value project)" --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding fairshift-session-secret \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor

# 3. Build from source with the Dockerfile and deploy.
gcloud run deploy fairshift \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars DEMO_MODE=true \
  --set-secrets SESSION_SECRET=fairshift-session-secret:latest \
  --max-instances 1 \
  --memory 512Mi
```

Then open the service URL that `gcloud` prints and check `https://<service-url>/healthz`, which should return `{"status":"ok"}`.

`--max-instances 1` matters in the demo configuration: each instance has its own SQLite file, so more than one instance would show different data to different requests.

## Persistence and migrations

- **Schema:** the schema in `src/server/db/schema.ts` is applied at startup with `CREATE TABLE/INDEX IF NOT EXISTS`. There is no separate migration step, and no destructive migration is ever run automatically.
- **Seeding:** the synthetic dataset is seeded only when the database has no organisations and `DEMO_MODE=true`.
- **Data loss on Cloud Run:** the container filesystem (including `/tmp`) is in-memory and per instance. Data written on Cloud Run is lost when the instance is stopped or replaced, for example by scale-to-zero after idle time or a new revision. This is acceptable for a demonstration. Each fresh instance re-seeds the same synthetic dataset relative to the current date.
- **Keeping one instance warm:** add `--min-instances 1` to keep an instance running, at extra cost.
- **Production persistence:** use a managed database such as Cloud SQL for PostgreSQL. Data access is confined to `src/server/repositories` and `src/server/services`, which use plain SQL with named parameters, so the work is a driver swap plus making the services async. Do not use SQLite on a network file system with multiple instances.

## Local production check

```bash
npm ci && npm run build
NODE_ENV=production DEMO_MODE=true SESSION_SECRET=<32+ chars> PORT=8080 npm start
```

Over plain `http://localhost` the browser will not send the `Secure` session cookie, so sign-in works only behind HTTPS (as on Cloud Run). Use `npm run dev` for local use.

## Container build without gcloud

```bash
docker build -t fairshift .
docker run --rm -p 8080:8080 -e DEMO_MODE=true -e SESSION_SECRET=<32+ chars> fairshift
```

## Vercel (demo deployment)

The Prompt Wars submission rules require Google Cloud Run for the final hosted link, so use Vercel only for an additional demo.

```bash
npm ci
npm run build:vercel        # writes .vercel/output (static client + one bundled API function)
npx vercel deploy --prebuilt --prod   --env NODE_ENV=production --env DEMO_MODE=true --env SESSION_SECRET=<48+ random chars>
```

- **How requests are served:** `scripts/build-vercel.mjs` creates a Build Output API v3 directory. The client is served as static files, `/api/*` and `/healthz` go to `src/server/vercel.ts` (the same Express app), and every other path falls back to `index.html`.
- **Data:** the database lives in `/tmp` and is re-seeded with synthetic data whenever a function instance starts. Different instances may show different demo data, and changes do not persist. This is acceptable for a demonstration only.
- **Session secret:** set `SESSION_SECRET` so that sessions are valid across instances.
