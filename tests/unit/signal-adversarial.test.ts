import { describe, expect, it } from 'vitest';
import {
  analyzeSafeSignals,
  detectCategoryClusters,
  detectPersistentUnresolved,
  detectReopenedClusters,
  deduplicateReports,
  hasSufficientDistinctReporters,
  type SignalReportInput,
} from '../../src/domain/signal';
import { openDb } from '../../src/server/db/db';
import { seedIfEmpty } from '../../src/server/db/seed';
import { getOrg } from '../../src/server/repositories/orgs';
import { getSafeSignals } from '../../src/server/services/signal';
import type { AppContext } from '../../src/server/context';

describe('Safe Signal — Adversarial Privacy, Inference & Differencing Audit', () => {
  const now = new Date('2026-10-30T10:00:00.000Z');
  const categories = [
    { key: 'fall', label: 'Falls and working at height' },
    { key: 'electrical', label: 'Electrical safety' },
    { key: 'ppe', label: 'Personal protective equipment' },
    { key: 'chemical', label: 'Hazardous substances' },
  ];
  const categoryMap = new Map(categories.map((c) => [c.key, c.label]));

  describe('Adversarial Vector 1: Strict Cohort Suppression (k < 3)', () => {
    it('strictly suppresses cohorts with 0, 1, or 2 reports', () => {
      // k = 0
      expect(detectCategoryClusters([], categoryMap, now)).toHaveLength(0);

      // k = 1
      const singleReport: SignalReportInput[] = [
        { id: 'rep_1', category: 'fall', severity: 'critical', status: 'submitted', createdAt: '2026-10-25T08:00:00Z', resolvedAt: null },
      ];
      expect(detectCategoryClusters(singleReport, categoryMap, now)).toHaveLength(0);
      expect(analyzeSafeSignals(singleReport, categories, now)).toHaveLength(0);

      // k = 2
      const pairReports: SignalReportInput[] = [
        { id: 'rep_1', category: 'fall', severity: 'critical', status: 'submitted', createdAt: '2026-10-25T08:00:00Z', resolvedAt: null },
        { id: 'rep_2', category: 'fall', severity: 'high', status: 'acknowledged', createdAt: '2026-10-26T09:00:00Z', resolvedAt: null },
      ];
      expect(detectCategoryClusters(pairReports, categoryMap, now)).toHaveLength(0);
      expect(analyzeSafeSignals(pairReports, categories, now)).toHaveLength(0);
    });

    it('emits signal once k >= 3 is reached with multi-reporter diversity', () => {
      const validCohort: SignalReportInput[] = [
        { id: 'rep_1', category: 'fall', severity: 'medium', status: 'submitted', createdAt: '2026-10-25T08:00:00Z', resolvedAt: null, reporterKey: 'user_1' },
        { id: 'rep_2', category: 'fall', severity: 'high', status: 'acknowledged', createdAt: '2026-10-26T09:00:00Z', resolvedAt: null, reporterKey: 'user_2' },
        {
          id: 'rep_3',
          category: 'fall',
          severity: 'critical',
          status: 'submitted',
          createdAt: '2026-10-27T10:00:00Z',
          resolvedAt: null,
          reporterKey: 'user_3',
        },
      ];

      const signals = detectCategoryClusters(validCohort, categoryMap, now);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.category).toBe('fall');
      expect(signals[0]?.reportCount).toBe(3);
    });
  });

  describe('Adversarial Vector 2: Single-Worker Sybil & Self-Identification Defense', () => {
    it('suppresses category cluster when all 3 reports originate from the same reporter', () => {
      // 3 reports submitted by the SAME worker ('user_solo')
      const singleWorkerSpam: SignalReportInput[] = [
        { id: 'rep_1', category: 'fall', severity: 'high', status: 'submitted', createdAt: '2026-10-25T08:00:00Z', resolvedAt: null, reporterKey: 'user_solo' },
        { id: 'rep_2', category: 'fall', severity: 'high', status: 'submitted', createdAt: '2026-10-26T09:00:00Z', resolvedAt: null, reporterKey: 'user_solo' },
        {
          id: 'rep_3',
          category: 'fall',
          severity: 'critical',
          status: 'submitted',
          createdAt: '2026-10-27T10:00:00Z',
          resolvedAt: null,
          reporterKey: 'user_solo',
        },
      ];

      expect(hasSufficientDistinctReporters(singleWorkerSpam, 2)).toBe(false);
      const clusters = detectCategoryClusters(singleWorkerSpam, categoryMap, now, 14, 3, 2);
      expect(clusters).toHaveLength(0);
    });

    it('applies the distinct-reporter requirement in the full analysis pipeline, not only in isolated rules', () => {
      // One worker files 4 distinct fall reports over several days: enough reports for every rule,
      // persistent (older than 7 days, unresolved) and escalating in severity.
      const soloReports: SignalReportInput[] = [
        {
          id: 's1',
          category: 'fall',
          severity: 'low',
          status: 'submitted',
          createdAt: '2026-10-15T08:00:00Z',
          resolvedAt: null,
          reporterKey: 'solo',
          title: 'A',
        },
        {
          id: 's2',
          category: 'fall',
          severity: 'low',
          status: 'submitted',
          createdAt: '2026-10-16T08:00:00Z',
          resolvedAt: null,
          reporterKey: 'solo',
          title: 'B',
        },
        {
          id: 's3',
          category: 'fall',
          severity: 'critical',
          status: 'submitted',
          createdAt: '2026-10-17T08:00:00Z',
          resolvedAt: null,
          reporterKey: 'solo',
          title: 'C',
        },
        {
          id: 's4',
          category: 'fall',
          severity: 'critical',
          status: 'submitted',
          createdAt: '2026-10-18T08:00:00Z',
          resolvedAt: null,
          reporterKey: 'solo',
          title: 'D',
        },
      ];
      expect(analyzeSafeSignals(soloReports, categories, now)).toHaveLength(0);

      // A second, distinct reporter makes the same pattern reportable.
      const withSecond = [...soloReports.slice(0, 3), { ...soloReports[3]!, reporterKey: 'other' }];
      expect(analyzeSafeSignals(withSecond, categories, now).length).toBeGreaterThan(0);
    });

    it('emits signal when at least 2 distinct workers contribute to the cohort', () => {
      const multiWorkerCohort: SignalReportInput[] = [
        { id: 'rep_1', category: 'fall', severity: 'high', status: 'submitted', createdAt: '2026-10-25T08:00:00Z', resolvedAt: null, reporterKey: 'user_a' },
        { id: 'rep_2', category: 'fall', severity: 'medium', status: 'submitted', createdAt: '2026-10-26T09:00:00Z', resolvedAt: null, reporterKey: 'user_a' },
        {
          id: 'rep_3',
          category: 'fall',
          severity: 'critical',
          status: 'submitted',
          createdAt: '2026-10-27T10:00:00Z',
          resolvedAt: null,
          reporterKey: 'user_b',
        },
      ];

      expect(hasSufficientDistinctReporters(multiWorkerCohort, 2)).toBe(true);
      const clusters = detectCategoryClusters(multiWorkerCohort, categoryMap, now, 14, 3, 2);
      expect(clusters).toHaveLength(1);
    });
  });

  describe('Adversarial Vector 3: Differencing & Immediate Resubmission Attacks', () => {
    it('deduplicates immediate repeat submissions within 15 minutes at the same location', () => {
      const immediateRepeats: SignalReportInput[] = [
        {
          id: 'rep_1',
          category: 'chemical',
          severity: 'high',
          status: 'submitted',
          createdAt: '2026-10-28T09:00:00Z',
          resolvedAt: null,
          reporterKey: 'user_1',
          location: 'Storage Bay 3',
        },
        {
          id: 'rep_2',
          category: 'chemical',
          severity: 'high',
          status: 'submitted',
          createdAt: '2026-10-28T09:05:00Z',
          resolvedAt: null,
          reporterKey: 'user_1',
          location: 'Storage Bay 3',
        },
        {
          id: 'rep_3',
          category: 'chemical',
          severity: 'high',
          status: 'submitted',
          createdAt: '2026-10-28T09:10:00Z',
          resolvedAt: null,
          reporterKey: 'user_1',
          location: 'Storage Bay 3',
        },
      ];

      const deduplicated = deduplicateReports(immediateRepeats);
      expect(deduplicated).toHaveLength(1);
    });

    it('preserves reports separated in time or by different reporters', () => {
      const legitimateReports: SignalReportInput[] = [
        {
          id: 'rep_1',
          category: 'chemical',
          severity: 'high',
          status: 'submitted',
          createdAt: '2026-10-28T09:00:00Z',
          resolvedAt: null,
          reporterKey: 'user_1',
          location: 'Storage Bay 3',
        },
        {
          id: 'rep_2',
          category: 'chemical',
          severity: 'high',
          status: 'submitted',
          createdAt: '2026-10-28T09:05:00Z',
          resolvedAt: null,
          reporterKey: 'user_2',
          location: 'Storage Bay 3',
        },
        {
          id: 'rep_3',
          category: 'chemical',
          severity: 'high',
          status: 'submitted',
          createdAt: '2026-10-28T10:30:00Z',
          resolvedAt: null,
          reporterKey: 'user_1',
          location: 'Storage Bay 3',
        },
      ];

      const deduplicated = deduplicateReports(legitimateReports);
      expect(deduplicated).toHaveLength(3);
    });
  });

  describe('Adversarial Vector 4: Invalid Timestamps & Malformed Input Handling', () => {
    it('gracefully discards invalid date strings and far-future timestamps without crashing', () => {
      const malformedDates: SignalReportInput[] = [
        { id: 'rep_1', category: 'electrical', severity: 'high', status: 'submitted', createdAt: 'not-a-valid-date', resolvedAt: null, reporterKey: 'u1' },
        { id: 'rep_2', category: 'electrical', severity: 'high', status: 'submitted', createdAt: '2099-01-01T00:00:00Z', resolvedAt: null, reporterKey: 'u2' }, // far future
        {
          id: 'rep_3',
          category: 'electrical',
          severity: 'critical',
          status: 'submitted',
          createdAt: '2026-10-28T10:00:00Z',
          resolvedAt: null,
          reporterKey: 'u3',
        },
      ];

      // Should not throw and should not trigger cluster (only 1 valid report within window)
      const signals = analyzeSafeSignals(malformedDates, categories, now);
      expect(signals).toHaveLength(0);
    });
  });

  describe('Adversarial Vector 5: Reopened Reports Cluster Rule', () => {
    it('detects recurring hazards where remediated reports were repeatedly reopened', () => {
      const reopenedReports: SignalReportInput[] = [
        { id: 'rep_1', category: 'fall', severity: 'high', status: 'reopened', createdAt: '2026-10-20T08:00:00Z', resolvedAt: null, reporterKey: 'u1' },
        { id: 'rep_2', category: 'fall', severity: 'high', status: 'reopened', createdAt: '2026-10-22T08:00:00Z', resolvedAt: null, reporterKey: 'u2' },
        { id: 'rep_3', category: 'fall', severity: 'critical', status: 'reopened', createdAt: '2026-10-25T08:00:00Z', resolvedAt: null, reporterKey: 'u3' },
      ];

      const reopenedSignals = detectReopenedClusters(reopenedReports, categoryMap, now);
      expect(reopenedSignals).toHaveLength(1);
      expect(reopenedSignals[0]?.rule).toBe('reopened_cluster');
      expect(reopenedSignals[0]?.statusSummary.reopenedCount).toBe(3);
    });

    it('excludes outcome_verified reports from persistent_unresolved signals', () => {
      const verifiedReports: SignalReportInput[] = [
        {
          id: 'rep_1',
          category: 'ppe',
          severity: 'high',
          status: 'outcome_verified',
          createdAt: '2026-10-10T08:00:00Z',
          resolvedAt: '2026-10-15T08:00:00Z',
          reporterKey: 'u1',
        },
        {
          id: 'rep_2',
          category: 'ppe',
          severity: 'high',
          status: 'outcome_verified',
          createdAt: '2026-10-12T08:00:00Z',
          resolvedAt: '2026-10-15T08:00:00Z',
          reporterKey: 'u2',
        },
        {
          id: 'rep_3',
          category: 'ppe',
          severity: 'medium',
          status: 'outcome_verified',
          createdAt: '2026-10-14T08:00:00Z',
          resolvedAt: '2026-10-15T08:00:00Z',
          reporterKey: 'u3',
        },
      ];

      const persistent = detectPersistentUnresolved(verifiedReports, categoryMap, now);
      expect(persistent).toHaveLength(0);
    });
  });

  describe('Adversarial Vector 6: Zero Leakage of Reporter Identifiers in API Layer', () => {
    it('guarantees getSafeSignals output contains zero reporter identifiers or raw tokens', () => {
      const clock = { now: new Date('2026-10-30T10:00:00.000Z') };
      const ctx: AppContext = {
        db: openDb(':memory:'),
        config: {
          port: 0,
          production: false,
          sessionSecret: 'secret'.padEnd(32, 'x'),
          receiptSigningSecret: 'secret'.padEnd(32, 'x'),
          receiptSigningKeys: { v1: 'secret'.padEnd(32, 'x') },
          activeReceiptKeyId: 'v1',
          checkpointSigningSecret: 'secret'.padEnd(32, 'x'),
          checkpointSigningKeys: { chk_v1: 'secret'.padEnd(32, 'x') },
          activeCheckpointKeyId: 'chk_v1',
          signalPseudonymSecret: 'secret'.padEnd(32, 'x'),
          databasePath: ':memory:',
          demoMode: true,
          smsProvider: 'mock',
        },
        now: () => clock.now,
      };
      seedIfEmpty(ctx);
      const org = getOrg(ctx.db, 'org_demo_construction')!;

      const response = getSafeSignals(ctx, org);
      const json = JSON.stringify(response);

      // Verify no sensitive keys exist in serialized payload
      expect(json).not.toContain('reporterKey');
      expect(json).not.toContain('reporter_id');
      expect(json).not.toContain('reporter_ref');
      expect(json).not.toContain('reporterId');
      expect(json).not.toContain('reporterRef');
      expect(json).not.toContain('usr_demo');
      expect(json).not.toContain('9000000'); // phone numbers
    });
  });
});
