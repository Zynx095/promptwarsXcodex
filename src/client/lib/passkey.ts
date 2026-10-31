// Passkeys on the worker's phone. The browser and the phone's operating system run the check
// (fingerprint, face or screen-lock PIN, whichever the phone uses); this code only passes the
// server's challenge to the browser and the signed answer back. Nothing here decides success:
// the server verifies every answer before it records attendance.
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from './api';
import type { PasskeyDTO } from '../../shared/types';

export type DeviceSupport = 'platform' | 'webauthn-only' | 'none';

/** Whether this phone can make a passkey unlocked by its own screen lock. */
export async function deviceSupport(): Promise<DeviceSupport> {
  if (!browserSupportsWebAuthn()) return 'none';
  try {
    return (await platformAuthenticatorIsAvailable()) ? 'platform' : 'webauthn-only';
  } catch {
    return 'webauthn-only';
  }
}

/** Distinguishes "the person cancelled or the phone said no" from other failures. */
export function isCancelled(err: unknown): boolean {
  return err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

export async function enrolPasskey(label: string): Promise<PasskeyDTO> {
  const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/passkeys/register-options', { method: 'POST', body: {} });
  const response = await startRegistration({ optionsJSON: options });
  return api<PasskeyDTO>('/passkeys/register', { method: 'POST', body: { label, response } });
}

/** Asks the phone to confirm it is the worker; returns the signed answer for the server to check. */
export async function attendanceAssertion(action: 'check-in' | 'check-out') {
  const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/attendance/passkey-options', { method: 'POST', body: { action } });
  return startAuthentication({ optionsJSON: options });
}
