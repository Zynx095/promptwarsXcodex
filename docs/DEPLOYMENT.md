# Deploying FairShift

FairShift is a single container: the Node.js server listens on `$PORT` (Cloud Run sets it, default 8080), serves the API under `/api`, the built web client for every other path, and a health check at `/healthz`.

## Prerequisites

- A Google Cloud project with billing enabled.
- The `gcloud` CLI, authenticated (`gcloud auth login`) with a default project (`gcloud config set project YOUR_PROJECT_ID`).
- These APIs enabled: Cloud Run, Cloud Build, Artifact Registry, Secret Manager:
  ```bash
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
  ```

No other external services or credentials are required for the demo. Speech and photo analysis providers are optional (see below).

## Environment variables

| Variable                             | Required                        | Description                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                               | Set by Cloud Run                | HTTP port.                                                                                                                                                                                                                                                                        |
| `NODE_ENV`                           | Set in the image (`production`) | Enables `Secure` cookies, CSP/HSTS headers and static file serving.                                                                                                                                                                                                               |
| `SESSION_SECRET`                     | Yes for real use                | At least 32 random characters. Signs session cookies and confidential-report references. Store it in Secret Manager. If missing while `DEMO_MODE=true`, an ephemeral secret is generated and sessions end on restart. If missing with demo mode off, the server refuses to start. |
| `DATABASE_PATH`                      | No                              | SQLite file path. The image default is `/tmp/fairshift/fairshift.db`.                                                                                                                                                                                                             |
| `DEMO_MODE`                          | No                              | `true` seeds synthetic data into an empty database and enables the demo-account list on the sign-in page.                                                                                                                                                                         |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS` | For passkeys in production      | Relying party ID (the domain, e.g. `fairshift.example.org`) and the exact origins the app is served from, comma-separated (e.g. `https://fairshift.example.org`). Without them, passkeys are off in production; in development they default to localhost.                         |
| `GOOGLE_TTS_API_KEY`                 | No                              | Server voice for read-aloud when a phone has no voice for the worker's language. Restrict the key to the Text-to-Speech API.                                                                                                                                                      |
| `GOOGLE_VISION_API_KEY`              | No                              | Advisory analysis of safety photos. Without it, every photo goes to manual review. Restrict the key to the Vision API.                                                                                                                                                            |

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

## Persistence: what blocks a production deployment

Both hosting paths documented here keep the SQLite database on the instance's own disk (`/tmp`), which the platform discards when an instance stops, scales or is replaced. That is acceptable only for the synthetic demo. Real worker records, safety photos and passkeys need a durable database, and FairShift does not have one configured yet:

- The data layer (`src/server/db`, `repositories`, `services`) uses Node's synchronous SQLite driver with transactions. Moving to a managed database is either a driver swap that keeps synchronous calls (libSQL embedded replicas, e.g. Turso) or making the services asynchronous for PostgreSQL (Cloud SQL, Neon). Either needs an account and credentials for that database, which this repository does not have.
- Safety photos are stored in the database (up to six of 1.5 MB per stage per report); with a managed database they move with it, or can move to object storage.
- Until then, deploy only with `DEMO_MODE=true` and synthetic data, and say so on the deployment.

## Vercel (demo deployment)

The hosted demo runs on Vercel at <https://fairshift-nine-red.vercel.app>. The Vercel project is connected to the GitHub repository: every push to `main` deploys to production and pull requests get preview deployments. `vercel.json` sets the install command (`npm ci`) and build command (`npm run build:vercel`), whose `.vercel/output` Vercel deploys as-is.

Project environment variables: `SESSION_SECRET` (sensitive) and `DEMO_MODE=true` for Production and Preview; `WEBAUTHN_RP_ID=fairshift-nine-red.vercel.app` and `WEBAUTHN_ORIGINS=https://fairshift-nine-red.vercel.app` for Production. Do not set `NODE_ENV` in the project: it would also apply to the build and skip the dev dependencies the build needs. `src/server/vercel.ts` defaults it to `production`.

Manual deploys:

```bash
npx vercel deploy --prod                                    # remote build with vercel.json
npm ci && npm run build:vercel && npx vercel deploy --prebuilt --prod
```

- **How requests are served:** `scripts/build-vercel.mjs` creates a Build Output API v3 directory. The client is served as static files, `/api/*` and `/healthz` go to `src/server/vercel.ts` (the same Express app), and every other path falls back to `index.html`.
- **Data:** the database lives in `/tmp` and is re-seeded with synthetic data whenever a function instance starts. Instances do not share data, so a request may reach an instance that has not seen a change made through another, and changes are lost when an instance is recycled or a new deployment goes live. Sign-in works across instances because demo users are identical everywhere and a session cookie's version is adopted by an instance that has an older one. This is acceptable for a demonstration only.
- **Session secret:** set `SESSION_SECRET` so that sessions are valid across instances.
- **Request size:** Vercel functions accept bodies up to 4.5 MB; FairShift's largest request is one resized photo (about 2 MB of base64), so uploads fit.
- **Passkeys:** set `WEBAUTHN_RP_ID` to the deployment's domain and `WEBAUTHN_ORIGINS` to its `https://` origin. A passkey is tied to that domain, so passkeys made on a preview URL do not work on another URL.
- **Function check:** the bundled function (`.vercel/output/functions/api.func/index.mjs`) was started locally with `NODE_ENV=production` and answered health, auth configuration and sign-in correctly.
