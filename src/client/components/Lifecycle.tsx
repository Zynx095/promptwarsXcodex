// The accountability loop as a sequence: reported, seen, being fixed, fixed, outcome verified.
// Used compactly in report lists and in full on a report.
import { useI18n, type MessageKey } from '../lib/i18n';
import type { ReportStatus } from '../../shared/types';

export const LIFECYCLE: { key: MessageKey; statuses: ReportStatus[] }[] = [
  { key: 'life.reported', statuses: ['submitted'] },
  { key: 'life.seen', statuses: ['acknowledged'] },
  { key: 'life.fixing', statuses: ['in_progress'] },
  { key: 'life.fixed', statuses: ['resolved', 'follow_up_pending'] },
  { key: 'life.verified', statuses: ['outcome_verified'] },
];

/** Index of the stage a status has reached; a reopened report starts again at "reported". */
export function lifecycleStep(status: ReportStatus): number {
  if (status === 'reopened') return 0;
  return LIFECYCLE.findIndex((s) => s.statuses.includes(status));
}

export function LifecycleBar({ status }: { status: ReportStatus }) {
  const { t } = useI18n();
  const step = lifecycleStep(status);
  return (
    <span className={`lifebar${status === 'reopened' ? ' is-reopened' : ''}`} aria-hidden="true" title={t(`status.${status}`)}>
      {LIFECYCLE.map((s, i) => (
        <span key={s.key} className={i <= step ? 'is-done' : undefined} />
      ))}
    </span>
  );
}

export function LifecycleSteps({ status, followUpDate }: { status: ReportStatus; followUpDate?: string | null }) {
  const { t } = useI18n();
  const step = lifecycleStep(status);
  return (
    <ol className="lifesteps" aria-label={t('life.label')}>
      {LIFECYCLE.map((s, i) => {
        const state = i < step ? 'done' : i === step ? 'current' : 'todo';
        return (
          <li key={s.key} className={`is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="lifestep-dot" aria-hidden="true" />
            <span className="lifestep-label">{t(s.key)}</span>
            {state === 'current' && status === 'follow_up_pending' ? (
              <span className="lifestep-note">{followUpDate ? t('life.followUpOn', { date: followUpDate }) : t('status.follow_up_pending')}</span>
            ) : null}
            {state === 'current' && status === 'reopened' ? <span className="lifestep-note">{t('status.reopened')}</span> : null}
            <span className="visually-hidden">{state === 'done' ? t('life.done') : state === 'current' ? t('life.now') : t('life.notYet')}</span>
          </li>
        );
      })}
    </ol>
  );
}
