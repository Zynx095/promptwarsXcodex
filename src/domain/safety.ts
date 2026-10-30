// Safety-report lifecycle. A hazard is "reported" until an authorised administrator records
// each status change; resolution is never inferred automatically.
import { DomainError } from './errors';
import type { ReportStatus, Severity } from '../shared/types';

export const REPORT_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  submitted: ['acknowledged'],
  acknowledged: ['in_progress', 'resolved'],
  in_progress: ['resolved', 'follow_up_pending'],
  resolved: ['follow_up_pending', 'outcome_verified', 'reopened'],
  follow_up_pending: ['outcome_verified', 'reopened', 'in_progress', 'resolved'],
  outcome_verified: ['reopened'],
  reopened: ['acknowledged', 'in_progress', 'resolved'],
};

/** Transitions that must carry an explanatory note. */
const NOTE_REQUIRED: ReadonlySet<ReportStatus> = new Set(['resolved', 'reopened', 'follow_up_pending', 'outcome_verified']);

export function allowedTransitions(from: ReportStatus): readonly ReportStatus[] {
  return REPORT_TRANSITIONS[from];
}

export function assertTransition(from: ReportStatus, to: ReportStatus, note: string): void {
  if (!REPORT_TRANSITIONS[from].includes(to)) {
    throw new DomainError('INVALID_TRANSITION', `A report that is "${label(from)}" cannot be changed to "${label(to)}".`);
  }
  if (to === 'outcome_verified' && note.trim().length < 5) {
    throw new DomainError('NOTE_REQUIRED', 'Outcome verification requires a specific note explaining how the physical hazard was inspected.');
  }
  if (NOTE_REQUIRED.has(to) && note.trim().length < 3) {
    const action = to === 'resolved' ? 'resolved' : to === 'reopened' ? 'reopened' : label(to);
    throw new DomainError('NOTE_REQUIRED', `Add a note explaining why the report is being ${action}.`);
  }
}

export function isUnresolved(status: ReportStatus): boolean {
  return status !== 'resolved' && status !== 'outcome_verified' && status !== 'follow_up_pending';
}

export const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function label(status: ReportStatus): string {
  return status.replace(/_/g, ' ');
}
