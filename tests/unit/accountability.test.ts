import { describe, expect, it } from 'vitest';
import { assertTransition, isUnresolved } from '../../src/domain/safety';
import { calculateAccountabilityMetrics, type AccountabilityEventInput, type AccountabilityReportInput } from '../../src/domain/accountability';
import { DomainError } from '../../src/domain/errors';

describe('FairShift Accountability Loop — Safety Lifecycle State Machine', () => {
  it('allows full accountability path from submission to outcome verification', () => {
    // 1. Worker submits -> Admin acknowledges
    expect(() => assertTransition('submitted', 'acknowledged', '')).not.toThrow();

    // 2. Acknowledged -> in_progress
    expect(() => assertTransition('acknowledged', 'in_progress', '')).not.toThrow();

    // 3. In progress -> resolved with corrective action
    expect(() => assertTransition('in_progress', 'resolved', 'Installed physical barrier and toe board')).not.toThrow();

    // 4. Resolved -> follow_up_pending (inspection scheduled)
    expect(() => assertTransition('resolved', 'follow_up_pending', 'Inspection scheduled for next Monday')).not.toThrow();

    // 5. Follow up pending -> outcome_verified
    expect(() => assertTransition('follow_up_pending', 'outcome_verified', 'Auditor verified barrier is anchored and secure')).not.toThrow();
  });

  it('allows follow-up to reopen if verification finds failure', () => {
    expect(() => assertTransition('follow_up_pending', 'reopened', 'Barrier anchor was broken during night shift')).not.toThrow();
  });

  it('allows outcome_verified to reopen if hazard recurs in the future', () => {
    expect(() => assertTransition('outcome_verified', 'reopened', 'Excavation shifted anchor post')).not.toThrow();
  });

  it('rejects skipping steps or unpermitted transitions', () => {
    // Cannot skip straight from submitted to outcome_verified
    expect(() => assertTransition('submitted', 'outcome_verified', 'done')).toThrow(DomainError);
    // Cannot skip from submitted to follow_up_pending
    expect(() => assertTransition('submitted', 'follow_up_pending', 'done')).toThrow(DomainError);
    // Cannot transition from outcome_verified back to acknowledged without reopening first
    expect(() => assertTransition('outcome_verified', 'acknowledged', '')).toThrow(DomainError);
  });

  it('requires an explanatory note for resolution, reopening, follow-up scheduling, and outcome verification', () => {
    expect(() => assertTransition('in_progress', 'resolved', '  ')).toThrow(/note/i);
    expect(() => assertTransition('resolved', 'reopened', '')).toThrow(/note/i);
    expect(() => assertTransition('resolved', 'follow_up_pending', ' ')).toThrow(/note/i);
    expect(() => assertTransition('follow_up_pending', 'outcome_verified', 'ab')).toThrow(/note/i);
  });

  it('correctly categorizes unresolved statuses', () => {
    expect(isUnresolved('submitted')).toBe(true);
    expect(isUnresolved('acknowledged')).toBe(true);
    expect(isUnresolved('in_progress')).toBe(true);
    expect(isUnresolved('reopened')).toBe(true);

    // Resolved, follow-up pending, and verified have active corrective action implemented
    expect(isUnresolved('resolved')).toBe(false);
    expect(isUnresolved('follow_up_pending')).toBe(false);
    expect(isUnresolved('outcome_verified')).toBe(false);
  });
});

describe('FairShift Accountability Loop — Pure Metrics Calculations', () => {
  it('returns clean zero/null defaults when no reports exist', () => {
    const metrics = calculateAccountabilityMetrics([], [], '2026-10-30');
    expect(metrics).toEqual({
      totalReports: 0,
      openReports: 0,
      resolvedCount: 0,
      followUpPendingCount: 0,
      verifiedCount: 0,
      reopenedCount: 0,
      meanTimeToAcknowledgeMinutes: null,
      meanTimeToResolveMinutes: null,
      verificationRatePercent: 0,
      reopenRatePercent: 0,
      overdueFollowUps: 0,
    });
  });

  it('calculates MTTA, MTTR, verification rate, and overdue follow-ups accurately', () => {
    const reports: AccountabilityReportInput[] = [
      {
        id: 'rep_1',
        category: 'fall',
        severity: 'high',
        status: 'outcome_verified',
        createdAt: '2026-10-01T08:00:00Z',
        resolvedAt: '2026-10-01T12:00:00Z',
        verifiedAt: '2026-10-02T10:00:00Z',
      },
      {
        id: 'rep_2',
        category: 'ppe',
        severity: 'medium',
        status: 'follow_up_pending',
        createdAt: '2026-10-01T09:00:00Z',
        resolvedAt: '2026-10-01T15:00:00Z',
        followUpDate: '2026-10-05', // Earlier than today -> overdue
      },
      {
        id: 'rep_3',
        category: 'electrical',
        severity: 'low',
        status: 'follow_up_pending',
        createdAt: '2026-10-05T09:00:00Z',
        resolvedAt: '2026-10-05T11:00:00Z',
        followUpDate: '2026-10-25', // Later than today -> not overdue
      },
      {
        id: 'rep_4',
        category: 'heat',
        severity: 'low',
        status: 'in_progress',
        createdAt: '2026-10-09T08:00:00Z',
        resolvedAt: null,
      },
    ];

    const events: AccountabilityEventInput[] = [
      // rep_1: acknowledged at 08:30 (30 mins), resolved at 12:00 (240 mins)
      { reportId: 'rep_1', fromStatus: null, toStatus: 'submitted', createdAt: '2026-10-01T08:00:00Z' },
      { reportId: 'rep_1', fromStatus: 'submitted', toStatus: 'acknowledged', createdAt: '2026-10-01T08:30:00Z' },
      { reportId: 'rep_1', fromStatus: 'acknowledged', toStatus: 'resolved', createdAt: '2026-10-01T12:00:00Z' },
      { reportId: 'rep_1', fromStatus: 'resolved', toStatus: 'outcome_verified', createdAt: '2026-10-02T10:00:00Z' },

      // rep_2: acknowledged at 10:00 (60 mins), resolved at 15:00 (360 mins)
      { reportId: 'rep_2', fromStatus: null, toStatus: 'submitted', createdAt: '2026-10-01T09:00:00Z' },
      { reportId: 'rep_2', fromStatus: 'submitted', toStatus: 'acknowledged', createdAt: '2026-10-01T10:00:00Z' },
      { reportId: 'rep_2', fromStatus: 'acknowledged', toStatus: 'resolved', createdAt: '2026-10-01T15:00:00Z' },
      { reportId: 'rep_2', fromStatus: 'resolved', toStatus: 'follow_up_pending', createdAt: '2026-10-01T15:30:00Z' },

      // rep_3: acknowledged at 09:30 (30 mins), resolved at 11:00 (120 mins), reopened once then resolved
      { reportId: 'rep_3', fromStatus: null, toStatus: 'submitted', createdAt: '2026-10-05T09:00:00Z' },
      { reportId: 'rep_3', fromStatus: 'submitted', toStatus: 'acknowledged', createdAt: '2026-10-05T09:30:00Z' },
      { reportId: 'rep_3', fromStatus: 'acknowledged', toStatus: 'resolved', createdAt: '2026-10-05T11:00:00Z' },
      { reportId: 'rep_3', fromStatus: 'resolved', toStatus: 'reopened', createdAt: '2026-10-05T14:00:00Z' },
      { reportId: 'rep_3', fromStatus: 'reopened', toStatus: 'resolved', createdAt: '2026-10-05T16:00:00Z' },
      { reportId: 'rep_3', fromStatus: 'resolved', toStatus: 'follow_up_pending', createdAt: '2026-10-05T16:15:00Z' },

      // rep_4: acknowledged at 08:20 (20 mins), in progress
      { reportId: 'rep_4', fromStatus: null, toStatus: 'submitted', createdAt: '2026-10-09T08:00:00Z' },
      { reportId: 'rep_4', fromStatus: 'submitted', toStatus: 'acknowledged', createdAt: '2026-10-09T08:20:00Z' },
      { reportId: 'rep_4', fromStatus: 'acknowledged', toStatus: 'in_progress', createdAt: '2026-10-09T08:25:00Z' },
    ];

    const todayIso = '2026-10-10';
    const metrics = calculateAccountabilityMetrics(reports, events, todayIso);

    expect(metrics.totalReports).toBe(4);
    expect(metrics.openReports).toBe(1); // rep_4 is in_progress
    expect(metrics.verifiedCount).toBe(1); // rep_1
    expect(metrics.followUpPendingCount).toBe(2); // rep_2, rep_3
    expect(metrics.reopenedCount).toBe(1); // rep_3 was reopened

    // MTTA: (30 + 60 + 30 + 20) / 4 = 140 / 4 = 35 minutes
    expect(metrics.meanTimeToAcknowledgeMinutes).toBe(35);

    // MTTR: (240 + 360 + 120) / 3 = 720 / 3 = 240 minutes (4 hours)
    expect(metrics.meanTimeToResolveMinutes).toBe(240);

    // Verification rate: 1 verified / (0 resolved + 2 pending + 1 verified) = 1/3 = 33%
    expect(metrics.verificationRatePercent).toBe(33);

    // Reopen rate: 1 reopened / (3 completed + 1 reopened) = 1/4 = 25%
    expect(metrics.reopenRatePercent).toBe(25);

    // Overdue follow-ups: rep_2 is scheduled for 2026-10-05 which is < 2026-10-10
    expect(metrics.overdueFollowUps).toBe(1);
  });
});
