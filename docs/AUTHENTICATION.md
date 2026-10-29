# FairShift Authentication & Identity Architecture (V2.1)

This document details the multi-provider authentication, identity mapping, session management, and verification mechanisms in FairShift.

---

## 1. Overview & Principles

FairShift supports three primary authentication methods while strictly maintaining organizational boundaries and data isolation:

1. **Google OAuth 2.0 / OpenID Connect (OIDC)**: Secure single sign-on for organization staff and managers.
2. **Phone OTP Verification**: Cryptographic 6-digit one-time passcode delivered via SMS (Twilio or mock in local development).
3. **Employer-Issued PIN (Demo / Direct)**: Fast PIN sign-in for synthetic demo accounts and local offline testing.
4. **GitHub OAuth (Optional)**: Developer and technical administrator single sign-on.

### Core Security Principles

- **Zero Hardcoded Credentials**: All client IDs, client secrets, and API tokens are read strictly from environment variables.
- **Fail-Safe Unconfigured States**: When an authentication provider is unconfigured, the application gracefully explains the requirement without runtime crashes or exposing dummy sign-in endpoints.
- **Identity Mapping vs. Self-Registration**: FairShift does **not** allow arbitrary public registration to gain administrative access. An OAuth identity must map to a pre-provisioned user record within an organization. Unprovisioned identities receive a clear, human-readable guidance notice with their account email.
- **PKCE & Signed State**: Google OAuth implements Proof Key for Code Exchange (RFC 7636) and HMAC-SHA256-signed state cookies to prevent login CSRF and authorization code injection.
- **Replay Protection**: Phone OTP challenges are cryptographically hashed, subject to rate limiting and exponential lockout, and marked consumed upon use to prevent replay attacks.

---

## 2. Google OAuth 2.0 / OpenID Connect (OIDC)

### Authorization Flow with PKCE

1. **Initiation (`GET /api/auth/google/start`)**:
   - The server verifies Google is configured (`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`).
   - Generates a cryptographically random `code_verifier` (43–128 chars) and computes `code_challenge = BASE64URL(SHA256(code_verifier))`.
   - Generates random `state` and `nonce` tokens.
   - Signs an `fs_oauth_state` cookie using the server's `SESSION_SECRET`:
     ```json
     {
       "state": "...",
       "nonce": "...",
       "codeVerifier": "...",
       "exp": 1793355000000
     }
     ```
   - Sets `fs_oauth_state` with `HttpOnly`, `SameSite=Lax`, and `Max-Age=600` (10 minutes).
   - Redirects user to Google OAuth endpoint:
     `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=...&scope=openid%20email%20profile&code_challenge_method=S256&code_challenge=...&state=...`

2. **Callback Handling (`GET /api/auth/google/callback`)**:
   - Extracts authorization `code` and `state` from URL parameters.
   - Reads and validates the signed `fs_oauth_state` cookie using HMAC verification and constant-time equality.
   - If the cookie is missing or expired, redirects to `/login?auth_error=session_expired`.
   - If the state does not match, redirects to `/login?auth_error=state_mismatch` to prevent login CSRF.
   - Clears `fs_oauth_state` cookie.
   - Exchanges authorization `code` + `code_verifier` at `https://oauth2.googleapis.com/token` for tokens.
   - Validates the resulting `id_token` by querying Google's tokeninfo endpoint (`https://oauth2.googleapis.com/tokeninfo`):
     - Confirms token signature and validity.
     - Enforces audience matching: `aud === GOOGLE_CLIENT_ID`.
     - Enforces issuer matching: `iss in ['https://accounts.google.com', 'accounts.google.com']`.
     - Confirms `email_verified === true`.

3. **Identity Resolution**:
   - Looks up `auth_identities` table for `provider = 'google'` and `provider_user_id = sub`.
   - If found: authenticates linked `user_id`.
   - If not found: checks `users` table for an existing user with matching email:
     - If matched: automatically links the Google identity to that user record.
     - If no user matches: redirects to `/login?auth_error=unprovisioned&email=<encoded_email>`. No unauthorized user or admin account is created.

---

## 3. Phone OTP Authentication

### SMS Provider Architecture

FairShift abstracts SMS delivery through the `SmsProvider` interface:

```typescript
export interface SmsProvider {
  readonly name: string;
  isConfigured(): boolean;
  sendOtp(phone: string, code: string): Promise<void>;
}
```

Implementations:

- `UnconfiguredSmsProvider` (`SMS_PROVIDER=none`): Returns 503 `PROVIDER_NOT_CONFIGURED` with a clear explanation.
- `MockSmsProvider` (`SMS_PROVIDER=mock`): In-memory provider used in testing and local offline development.
- `TwilioSmsProvider` (`SMS_PROVIDER=twilio`): Uses Twilio REST API with Basic Auth (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_PHONE`).

### Security Controls

- **Challenge Generation**: 6-digit random number generated via `crypto.randomInt(100000, 1000000)`.
- **HMAC Storage**: Only `HMAC_SHA256(SESSION_SECRET, phone:code)` is persisted in the `phone_verifications` table. Raw codes are never stored in the database.
- **Rate Limiting & Cooldown**:
  - Enforces a 60-second cooldown between consecutive OTP dispatch requests for the same phone number (HTTP 429).
  - Enforces a maximum of 4 verification requests per 15-minute window (HTTP 429).
- **Brute-Force Protection**: Maximum 5 attempts allowed per verification challenge. After 5 incorrect attempts, the challenge is permanently locked.
- **Replay Protection**: When successfully verified or exhausted, the challenge is stamped with `consumed_at = now()`. Re-submitting the same code is strictly rejected.
- **Provisioning Check**: The authenticated phone number must correspond to an active FairShift user in the database.

---

## 4. GitHub OAuth (SSO)

Similar to Google OAuth, GitHub OAuth (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`) is supported for engineering and operations personnel:

- Callback endpoint: `GET /api/auth/github/callback`.
- Verified primary email is queried from GitHub API (`https://api.github.com/user/emails`).
- Linked to pre-provisioned FairShift administrator or worker accounts.

---

## 5. Synthetic Demo Mode Preservation

When `DEMO_MODE=true` is set:

- The server seeds sample organizations (Construction Site 14 and Campus Facilities) with workers and administrators.
- Identifiers and PINs (`1234`) are available for rapid evaluation.
- The `GET /api/demo/accounts` endpoint supplies sample credentials to the frontend demo picker.
- Demo identities are seeded into `auth_identities` for consistency.
- In production, set `DEMO_MODE=false`.

---

## 6. Environment Configuration Reference

| Variable               | Required  | Description                                                                 |
| ---------------------- | --------- | --------------------------------------------------------------------------- |
| `SESSION_SECRET`       | Yes       | 64+ character random string used to sign session cookies and OTP hashes.    |
| `DEMO_MODE`            | No        | Defaults to `true` in dev; set to `false` in production.                    |
| `GOOGLE_CLIENT_ID`     | Optional  | Google OAuth 2.0 Client ID.                                                 |
| `GOOGLE_CLIENT_SECRET` | Optional  | Google OAuth 2.0 Client Secret.                                             |
| `GOOGLE_CALLBACK_URL`  | Optional  | Optional callback URL override (defaults to server origin + callback path). |
| `GITHUB_CLIENT_ID`     | Optional  | GitHub OAuth App Client ID.                                                 |
| `GITHUB_CLIENT_SECRET` | Optional  | GitHub OAuth App Client Secret.                                             |
| `SMS_PROVIDER`         | No        | `none` (default), `mock`, or `twilio`.                                      |
| `TWILIO_ACCOUNT_SID`   | If Twilio | Twilio Account SID.                                                         |
| `TWILIO_AUTH_TOKEN`    | If Twilio | Twilio Auth Token.                                                          |
| `TWILIO_FROM_PHONE`    | If Twilio | Twilio originating phone number in E.164 format.                            |
