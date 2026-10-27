// Authorisation policy. Every check is made against the authenticated session loaded on the
// server; identifiers in requests are never trusted on their own.
import type { Role } from '../shared/types';

export interface Actor {
  id: string;
  orgId: string;
  role: Role;
}

export interface OwnedRecord {
  orgId: string;
  workerId: string;
}

export function sameOrg(actor: Actor, record: { orgId: string }): boolean {
  return actor.orgId === record.orgId;
}

/** Workers see their own records; admins see records in their own organisation only. */
export function canViewWorkerRecord(actor: Actor, record: OwnedRecord): boolean {
  if (!sameOrg(actor, record)) return false;
  return actor.role === 'admin' || actor.id === record.workerId;
}

export function isAdmin(actor: Actor): boolean {
  return actor.role === 'admin';
}

/**
 * Whether a viewer may see who submitted a safety report. Confidential reports reveal the
 * reporter only to the reporter themselves.
 */
export function canSeeReporter(actor: Actor, report: { confidential: boolean; isMine: boolean }): boolean {
  if (report.isMine) return true;
  return !report.confidential && actor.role === 'admin';
}
