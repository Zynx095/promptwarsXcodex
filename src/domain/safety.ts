// Safety-report lifecycle. A hazard is "reported" until an authorised administrator records
// each status change; resolution is never inferred automatically.
import { DomainError } from './errors';
import type { ReportStatus, Severity } from '../shared/types';

export const REPORT_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  submitted: ['acknowledged'],
  acknowledged: ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  resolved: ['reopened'],
  reopened: ['acknowledged', 'in_progress', 'resolved'],
};

/** Transitions that must carry an explanatory note. */
const NOTE_REQUIRED: ReadonlySet<ReportStatus> = new Set(['resolved', 'reopened']);

export function allowedTransitions(from: ReportStatus): readonly ReportStatus[] {
  return REPORT_TRANSITIONS[from];
}

export function assertTransition(from: ReportStatus, to: ReportStatus, note: string): void {
  if (!REPORT_TRANSITIONS[from].includes(to)) {
    throw new DomainError('INVALID_TRANSITION', `A report that is "${label(from)}" cannot be changed to "${label(to)}".`);
  }
  if (NOTE_REQUIRED.has(to) && note.trim().length < 3) {
    throw new DomainError('NOTE_REQUIRED', `Add a note explaining why the report is being ${to === 'resolved' ? 'resolved' : 'reopened'}.`);
  }
}

export function isUnresolved(status: ReportStatus): boolean {
  return status !== 'resolved';
}

export const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function label(status: ReportStatus): string {
  return status.replace('_', ' ');
}
