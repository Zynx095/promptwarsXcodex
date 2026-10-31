// Passkeys (WebAuthn) for attendance. A worker registers a passkey on their phone; from then on,
// checking in or out needs a fresh passkey check. The phone's own screen lock (fingerprint, face or
// device PIN) unlocks the passkey: FairShift never sees or stores a fingerprint, a face or any
// biometric data, only the public key. The server alone decides whether a check passed:
//   - every challenge is random, made by the server, tied to one user and one purpose, valid for
//     five minutes and deleted the moment it is used, so an assertion cannot be replayed;
//   - origin and relying-party ID are checked against configuration, not the request;
//   - user verification is required, the credential must belong to the signed-in user and not be
//     revoked, the signature must verify, and the signature counter may not go backwards.
import { createHash, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { DomainError } from '../../domain/errors';
import type { PasskeyDTO, PasskeysResponse } from '../../shared/types';
import { nowIso, type AppContext } from '../context';
import { recordAudit } from '../repositories/audit';
import type { SessionUserRow } from '../repositories/users';
import { HttpError } from '../http';

export type PasskeyPurpose = 'register' | 'check-in' | 'check-out';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PASSKEYS = 5;

export interface RelyingParty {
  rpId: string;
  origins: string[];
}

/**
 * The relying party comes from WEBAUTHN_RP_ID and WEBAUTHN_ORIGINS. Outside production, an unset
 * configuration defaults to localhost on the server's port so passkeys work in development.
 * In production without configuration, passkeys are off: deriving them from request headers
 * would let a forged Host header choose the origin being checked.
 */
export function relyingParty(ctx: AppContext): RelyingParty | null {
  const { webauthnRpId, webauthnOrigins, production, port } = ctx.config;
  if (webauthnRpId && webauthnOrigins?.length) return { rpId: webauthnRpId, origins: webauthnOrigins };
  if (production) return null;
  return { rpId: 'localhost', origins: [`http://localhost:${port}`, 'http://localhost:5173'] };
}

function requireRp(ctx: AppContext): RelyingParty {
  const rp = relyingParty(ctx);
  if (!rp) throw new HttpError(404, 'PASSKEYS_NOT_CONFIGURED', 'Passkeys are not set up on this server.');
  return rp;
}

interface PasskeyRow {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: number;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const SELECT = `SELECT id, user_id AS userId, credential_id AS credentialId, public_key AS publicKey, sign_count AS signCount, transports,
  device_type AS deviceType, backed_up AS backedUp, label, created_at AS createdAt, last_used_at AS lastUsedAt FROM passkeys`;

function activePasskeys(ctx: AppContext, userId: string): PasskeyRow[] {
  return ctx.db.all<PasskeyRow>(`${SELECT} WHERE user_id = @userId AND revoked_at IS NULL ORDER BY created_at`, { userId });
}

const toDTO = (p: PasskeyRow): PasskeyDTO => ({
  id: p.id,
  label: p.label,
  deviceType: p.deviceType,
  backedUp: Boolean(p.backedUp),
  createdAt: p.createdAt,
  lastUsedAt: p.lastUsedAt,
});

/** True when attendance actions need a passkey: the worker has registered at least one. */
export function passkeyRequired(ctx: AppContext, userId: string): boolean {
  return Boolean(ctx.db.get(`SELECT 1 AS ok FROM passkeys WHERE user_id = @userId AND revoked_at IS NULL LIMIT 1`, { userId }));
}

export function listPasskeys(ctx: AppContext, userId: string): PasskeysResponse {
  const items = activePasskeys(ctx, userId).map(toDTO);
  return { available: relyingParty(ctx) !== null, required: items.length > 0, items };
}

function issueChallenge(ctx: AppContext, userId: string, purpose: PasskeyPurpose, challenge: string): void {
  const now = ctx.now();
  ctx.db.tx(() => {
    // One outstanding challenge per user and purpose; expired ones are cleared as we go
    ctx.db.run(`DELETE FROM webauthn_challenges WHERE (user_id = @userId AND purpose = @purpose) OR expires_at < @now`, {
      userId,
      purpose,
      now: now.toISOString(),
    });
    ctx.db.run(
      `INSERT INTO webauthn_challenges (id, user_id, purpose, challenge, expires_at, created_at) VALUES (@id, @userId, @purpose, @challenge, @expires, @now)`,
      { id: randomUUID(), userId, purpose, challenge, expires: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(), now: now.toISOString() },
    );
  });
}

/**
 * Takes the challenge the browser signed out of storage. It is deleted whether or not the rest of
 * the check succeeds, so the same response can never be tried twice.
 */
function consumeChallenge(ctx: AppContext, userId: string, purpose: PasskeyPurpose, clientDataJSON: string): string {
  let signed: string | undefined;
  try {
    signed = (JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as { challenge?: string }).challenge;
  } catch {
    signed = undefined;
  }
  if (typeof signed !== 'string' || !signed) throw fail('The passkey response could not be read.');
  const row = ctx.db.get<{ id: string; expiresAt: string }>(
    `SELECT id, expires_at AS expiresAt FROM webauthn_challenges WHERE user_id = @userId AND purpose = @purpose AND challenge = @challenge`,
    { userId, purpose, challenge: signed },
  );
  if (!row) throw fail('This passkey check was already used or was never issued. Start again.');
  ctx.db.run(`DELETE FROM webauthn_challenges WHERE id = @id`, { id: row.id });
  if (row.expiresAt < ctx.now().toISOString()) throw fail('This passkey check expired. Start again.');
  return signed;
}

const fail = (message: string) => new DomainError('PASSKEY_FAILED', message);

/** Stable, non-identifying WebAuthn user handle: a hash of the internal user id. */
const userHandle = (userId: string) => new Uint8Array(createHash('sha256').update(`fairshift:webauthn-user:${userId}`).digest());

export async function registrationOptions(ctx: AppContext, user: SessionUserRow): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const rp = requireRp(ctx);
  const existing = activePasskeys(ctx, user.id);
  if (existing.length >= MAX_PASSKEYS) throw new DomainError('CONFLICT', `You can register up to ${MAX_PASSKEYS} passkeys. Remove one first.`);
  const options = await generateRegistrationOptions({
    rpName: 'FairShift',
    rpID: rp.rpId,
    userName: user.name,
    userDisplayName: user.name,
    userID: userHandle(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: JSON.parse(p.transports) as string[] })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required', authenticatorAttachment: 'platform' },
    timeout: CHALLENGE_TTL_MS,
  });
  issueChallenge(ctx, user.id, 'register', options.challenge);
  return options;
}

export async function registerPasskey(ctx: AppContext, user: SessionUserRow, response: RegistrationResponseJSON, label: string): Promise<PasskeyDTO> {
  const rp = requireRp(ctx);
  const challenge = consumeChallenge(ctx, user.id, 'register', response.response.clientDataJSON);
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
    });
  } catch (err) {
    throw fail(`The passkey could not be registered: ${err instanceof Error ? err.message : 'verification failed'}.`);
  }
  if (!verified.verified) throw fail('The passkey could not be registered.');
  const info = verified.registrationInfo;
  const at = nowIso(ctx);
  const id = randomUUID();
  const cleanLabel = label.trim().slice(0, 60) || 'This phone';
  ctx.db.tx(() => {
    if (ctx.db.get(`SELECT 1 AS ok FROM passkeys WHERE credential_id = @cid`, { cid: info.credential.id })) {
      throw new DomainError('CONFLICT', 'This passkey is already registered.');
    }
    ctx.db.run(
      `INSERT INTO passkeys (id, org_id, user_id, credential_id, public_key, sign_count, transports, device_type, backed_up, label, created_at)
       VALUES (@id, @orgId, @userId, @cid, @pk, @count, @transports, @deviceType, @backedUp, @label, @at)`,
      {
        id,
        orgId: user.orgId,
        userId: user.id,
        cid: info.credential.id,
        pk: Buffer.from(info.credential.publicKey).toString('base64url'),
        count: info.credential.counter,
        transports: JSON.stringify(info.credential.transports ?? []),
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        label: cleanLabel,
        at,
      },
    );
    recordAudit(ctx.db, {
      orgId: user.orgId,
      actorId: user.id,
      entityType: 'passkey',
      entityId: id,
      action: 'passkey_registered',
      after: { label: cleanLabel, deviceType: info.credentialDeviceType, userVerified: info.userVerified },
      at,
    });
  });
  return toDTO(ctx.db.get<PasskeyRow>(`${SELECT} WHERE id = @id`, { id })!);
}

export function revokePasskey(ctx: AppContext, actorId: string, orgId: string, userId: string, passkeyId: string | null): number {
  const at = nowIso(ctx);
  return ctx.db.tx(() => {
    const n = ctx.db.run(
      `UPDATE passkeys SET revoked_at = @at WHERE user_id = @userId AND org_id = @orgId AND revoked_at IS NULL AND (@passkeyId IS NULL OR id = @passkeyId)`,
      { at, userId, orgId, passkeyId },
    );
    if (n > 0) {
      ctx.db.run(`DELETE FROM webauthn_challenges WHERE user_id = @userId`, { userId });
      recordAudit(ctx.db, {
        orgId,
        actorId,
        entityType: 'passkey',
        entityId: passkeyId ?? userId,
        action: passkeyId ? 'passkey_revoked' : 'passkeys_revoked_all',
        after: { userId, count: n, byAdministrator: actorId !== userId },
        at,
      });
    }
    return n;
  });
}

export async function attendanceOptions(
  ctx: AppContext,
  user: SessionUserRow,
  purpose: 'check-in' | 'check-out',
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const rp = requireRp(ctx);
  const passkeys = activePasskeys(ctx, user.id);
  if (!passkeys.length) throw new DomainError('PASSKEY_REQUIRED', 'Register a passkey on this phone first.');
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: JSON.parse(p.transports) as string[] })),
    userVerification: 'required',
    timeout: CHALLENGE_TTL_MS,
  });
  issueChallenge(ctx, user.id, purpose, options.challenge);
  return options;
}

/**
 * Verifies a passkey assertion for one attendance action. Returns the passkey's label for the audit
 * trail; throws PASSKEY_FAILED (403) on any problem. Nothing is recorded unless this returns.
 */
export async function verifyAttendancePasskey(
  ctx: AppContext,
  user: SessionUserRow,
  purpose: 'check-in' | 'check-out',
  response: AuthenticationResponseJSON,
): Promise<{ label: string }> {
  const rp = requireRp(ctx);
  const challenge = consumeChallenge(ctx, user.id, purpose, response.response.clientDataJSON);
  const passkey = ctx.db.get<PasskeyRow & { revokedAt: string | null }>(
    `${SELECT.replace(' FROM passkeys', ', revoked_at AS revokedAt FROM passkeys')} WHERE credential_id = @cid`,
    { cid: response.id },
  );
  // A passkey of another worker, an unknown one and a revoked one fail the same way
  if (!passkey || passkey.userId !== user.id || passkey.revokedAt) throw fail('This passkey is not registered to you.');
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
        counter: passkey.signCount,
        transports: JSON.parse(passkey.transports) as string[],
      },
    });
  } catch (err) {
    throw fail(`The passkey check failed: ${err instanceof Error ? err.message : 'verification failed'}.`);
  }
  if (!verified.verified || !verified.authenticationInfo.userVerified) throw fail('The passkey check failed.');
  ctx.db.run(`UPDATE passkeys SET sign_count = @count, last_used_at = @at WHERE id = @id`, {
    id: passkey.id,
    count: verified.authenticationInfo.newCounter,
    at: nowIso(ctx),
  });
  return { label: passkey.label };
}
