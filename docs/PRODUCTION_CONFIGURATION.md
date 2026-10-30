# FairShift V4.0 — Production Configuration Reference

This document details all configuration options, environment variables, security classifications, and validation rules for FairShift V4.0.

---

## 1. Environment Variables Reference

| Variable                    | Required in Prod | Default Value          | Sensitivity | Purpose & Validation Rules                                                                                        |
| :-------------------------- | :--------------: | :--------------------- | :---------: | :---------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  |       Yes        | `development`          |   Public    | Set to `production` in live deployments. Enables strict CSP, HSTS, secure cookies, and disables mock credentials. |
| `PORT`                      |        No        | `3000`                 |   Public    | TCP port on which the Express HTTP server listens.                                                                |
| `DATABASE_PATH`             |       Yes        | `/data/fairshift.db`   |    High     | Absolute path to the SQLite database file on disk. Must reside on a persistent volume.                            |
| `SESSION_SECRET`            |       Yes        | _None (Fails in prod)_ |  Critical   | Secret used to sign session cookies and generate rotating site codes. Minimum 32 characters.                      |
| `RECEIPT_SIGNING_SECRET`    |       Yes        | _None (Fails in prod)_ |  Critical   | Primary HMAC-SHA256 secret used to seal work receipts (`v1`). Minimum 32 characters.                              |
| `ACTIVE_RECEIPT_KEY_ID`     |        No        | `v1`                   |   Public    | Key identifier corresponding to the active receipt signing key.                                                   |
| `RECEIPT_SIGNING_KEYS`      |        No        | `{}`                   |  Critical   | JSON dictionary mapping key identifiers to historical signing secrets (e.g. `{"v1":"...","v2":"..."}`).           |
| `CHECKPOINT_SIGNING_SECRET` |       Yes        | _None (Fails in prod)_ |  Critical   | Primary secret used to sign Merkle checkpoint roots (`chk_v1`). Minimum 32 characters.                            |
| `ACTIVE_CHECKPOINT_KEY_ID`  |        No        | `chk_v1`               |   Public    | Key identifier corresponding to the active checkpoint key.                                                        |
| `CHECKPOINT_SIGNING_KEYS`   |        No        | `{}`                   |  Critical   | JSON dictionary mapping key identifiers to historical checkpoint signing secrets.                                 |
| `SIGNAL_PSEUDONYM_SECRET`   |       Yes        | _None (Fails in prod)_ |  Critical   | Domain salt used to compute irreversible reporter pseudonyms for Safe Signal. Minimum 32 characters.              |
| `DEMO_MODE`                 |        No        | `false`                |   Public    | When `true`, displays demo account rosters on login screen. **Must be `false` in production.**                    |
| `SMS_PROVIDER`              |        No        | `unconfigured`         |    High     | Provider used for phone OTP delivery. Options: `unconfigured`, `mock`, `twilio`.                                  |

---

## 2. Authentication Provider Configurations

### Phone OTP (Twilio Integration)

When `SMS_PROVIDER=twilio`:

| Variable             | Required | Sensitivity | Description                             |
| :------------------- | :------: | :---------: | :-------------------------------------- |
| `TWILIO_ACCOUNT_SID` |   Yes    |    High     | Twilio Account SID from Console.        |
| `TWILIO_AUTH_TOKEN`  |   Yes    |  Critical   | Twilio Auth Token.                      |
| `TWILIO_FROM_NUMBER` |   Yes    |    High     | E.164 phone number purchased on Twilio. |

> [!CAUTION]
> In `NODE_ENV=production`, `SMS_PROVIDER=mock` is strictly prohibited by application runtime checks (`auth-adversarial.test.ts`). The application will refuse to dispatch mock SMS in production mode.

### Google OAuth 2.0 / OIDC

| Variable               | Required | Sensitivity | Description                                                                                            |
| :--------------------- | :------: | :---------: | :----------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | Optional |    High     | OAuth 2.0 Web Client ID from Google Cloud Console.                                                     |
| `GOOGLE_CLIENT_SECRET` | Optional |  Critical   | OAuth 2.0 Web Client Secret.                                                                           |
| `APP_BASE_URL`         | Optional |   Public    | Canonical URL of the deployment (e.g. `https://fairshift.org`) for OAuth callback redirect validation. |

### GitHub OAuth (Enterprise / Administration)

| Variable               | Required | Sensitivity | Description                                   |
| :--------------------- | :------: | :---------: | :-------------------------------------------- |
| `GITHUB_CLIENT_ID`     | Optional |    High     | OAuth App Client ID from GitHub Organization. |
| `GITHUB_CLIENT_SECRET` | Optional |  Critical   | OAuth App Client Secret.                      |

---

## 3. Production Security Checklist

1. **Entropy Requirements**: Generate all secrets with cryptographic entropy:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Reverse Proxy & TLS**: FairShift expects to run behind a TLS-terminating load balancer (Cloud Run, Cloudflare, or NGINX). Ensure `X-Forwarded-Proto: https` is forwarded.
3. **Cookie Configuration**: In production, cookies are flagged `HttpOnly; SameSite=Lax; Secure`.
