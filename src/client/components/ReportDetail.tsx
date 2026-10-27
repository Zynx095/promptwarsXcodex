// Safety report details and timestamped status history. Admins also get the transition form.
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/session';
import { formatDateTime } from '../lib/format';
import { allowedTransitions } from '../../domain/safety';
import { getIndustry } from '../../shared/industries';
import type { ReportStatus, SafetyReportDTO } from '../../shared/types';
import { Badge, Button, Card, ErrorBox, Field, Notice, ReportStatusBadge, SeverityBadge } from './ui';

export function ReportDetail({ report, onUpdated }: { report: SafetyReportDTO; onUpdated?: (r: SafetyReportDTO) => void }) {
  const { t, locale, category } = useI18n();
  const me = useMe();
  const tz = me.org.timezone;
  const cat = getIndustry(me.org.industry).hazardCategories.find((c) => c.key === report.category);

  return (
    <>
      <Card>
        <div className="row">
          <h2 style={{ margin: 0 }}>{report.title}</h2>
          <span className="row" style={{ gap: 8 }}>
            <SeverityBadge severity={report.severity} />
            <ReportStatusBadge status={report.status} />
          </span>
        </div>
        <p className="muted small">
          {t('rep.reportedOn', { date: formatDateTime(report.createdAt, tz, locale) })} · {category('hazard', report.category, cat?.label ?? report.category)} ·{' '}
          {report.location}
        </p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{report.description}</p>
        <p className="small">
          {report.confidential ? <Badge tone="info">Confidential</Badge> : null}{' '}
          {report.reporterName ? <span className="muted">Reported by {report.reporterName}</span> : report.confidential ? <span className="muted">Reporter identity protected</span> : null}
        </p>
        {report.assignee ? (
          <p>
            <strong>{t('rep.assignee')}:</strong> {report.assignee}
          </p>
        ) : null}
        {report.status !== 'resolved' ? <Notice kind="info">{t('rep.reportedHazardNote')}</Notice> : null}
        {report.synthetic ? <p className="muted small">Synthetic demo report.</p> : null}
      </Card>

      <Card title={t('rep.history')}>
        <ol className="timeline">
          {(report.history ?? []).map((h) => (
            <li key={h.id}>
              <strong>{t(`status.${h.toStatus}`)}</strong>
              <span className="muted small">
                {' '}
                · {formatDateTime(h.createdAt, tz, locale)} · {h.actorLabel}
              </span>
              {h.note ? <p style={{ margin: 0 }}>{h.note}</p> : null}
            </li>
          ))}
        </ol>
      </Card>

      {me.user.role === 'admin' && onUpdated ? <TransitionForm report={report} onUpdated={onUpdated} /> : null}
    </>
  );
}

const ACTION_LABEL: Record<ReportStatus, string> = {
  submitted: 'Submit',
  acknowledged: 'Acknowledge',
  in_progress: 'Mark work in progress',
  resolved: 'Mark resolved',
  reopened: 'Reopen',
};

function TransitionForm({ report, onUpdated }: { report: SafetyReportDTO; onUpdated: (r: SafetyReportDTO) => void }) {
  const options = allowedTransitions(report.status);
  const [to, setTo] = useState<ReportStatus>(options[0]!);
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState(report.assignee ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const needsNote = to === 'resolved' || to === 'reopened';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const updated = await api<SafetyReportDTO>(`/admin/reports/${report.id}/transition`, {
        method: 'POST',
        body: { to, note, assignee: assignee.trim() || null },
      });
      setNote('');
      setDone(`Report updated to "${ACTION_LABEL[to].toLowerCase()}".`);
      const next = allowedTransitions(updated.status);
      if (next[0]) setTo(next[0]);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Could not update the report.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Update status">
      <form onSubmit={submit} noValidate>
        <fieldset>
          <legend>Next step</legend>
          {options.map((o) => (
            <label key={o} className="check">
              <input type="radio" name="to" value={o} checked={to === o} onChange={() => setTo(o)} />
              <span>{ACTION_LABEL[o]}</span>
            </label>
          ))}
        </fieldset>
        <Field label="Responsible person" hint="Who will fix this? Leave empty if not assigned." optional error={error?.fields['assignee']}>
          <input value={assignee} onChange={(e) => setAssignee(e.target.value)} maxLength={80} />
        </Field>
        <Field
          label={needsNote ? 'Note (required)' : 'Note'}
          hint={needsNote ? 'Explain what was done, or why it is being reopened. The reporter can read this.' : 'Visible to the reporter.'}
          optional={!needsNote}
          error={error?.fields['note']}
        >
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <div aria-live="polite">
          {error && !Object.keys(error.fields).length ? <ErrorBox error={error} /> : null}
          {done ? <Notice kind="success">{done}</Notice> : null}
        </div>
        <Button type="submit" busy={busy}>
          {ACTION_LABEL[to]}
        </Button>
      </form>
    </Card>
  );
}
