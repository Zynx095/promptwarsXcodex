// Safety report details and timestamped status history. Admins also get the transition form.
import { useState } from 'react';
import { ShieldCheck, CalendarCheck, CheckCircle2 } from 'lucide-react';
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
          <h2 className="m-0">{report.title}</h2>
          <span className="row row-tight">
            <SeverityBadge severity={report.severity} />
            <ReportStatusBadge status={report.status} />
          </span>
        </div>
        <p className="muted small">
          {t('rep.reportedOn', { date: formatDateTime(report.createdAt, tz, locale) })} · {category('hazard', report.category, cat?.label ?? report.category)} ·{' '}
          {report.location}
        </p>
        <p className="pre-wrap">{report.description}</p>
        <p className="small">
          {report.confidential ? <Badge tone="info">Confidential</Badge> : null}{' '}
          {report.reporterName ? (
            <span className="muted">Reported by {report.reporterName}</span>
          ) : report.confidential ? (
            <span className="muted">Reporter identity protected</span>
          ) : null}
        </p>
        {report.assignee ? (
          <p>
            <strong>{t('rep.assignee')}:</strong> {report.assignee}
          </p>
        ) : null}

        {/* Accountability Loop: Corrective Action Display */}
        {report.actionTaken ? (
          <div className="p-3 my-3 rounded border" style={{ background: 'rgba(58, 15, 52, 0.03)', borderColor: 'rgba(58, 15, 52, 0.12)' }}>
            <strong className="text-sm block mb-1" style={{ color: 'var(--c-heading)' }}>
              Corrective Action Taken
            </strong>
            <p className="m-0 text-sm">{report.actionTaken}</p>
          </div>
        ) : null}

        {/* Accountability Loop: Scheduled Follow-Up */}
        {report.followUpDate ? (
          <p className="small text-muted mb-2 flex items-center gap-1">
            <CalendarCheck className="icon" style={{ width: 14, height: 14 }} aria-hidden="true" />
            <span><strong>Scheduled Follow-Up Inspection:</strong> {report.followUpDate}</span>
          </p>
        ) : null}

        {/* Accountability Loop: Outcome Verification Seal */}
        {report.verifiedAt ? (
          <div className="p-3 my-3 rounded border" style={{ background: 'rgba(46, 125, 50, 0.05)', borderColor: 'rgba(46, 125, 50, 0.3)' }}>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="icon text-good" style={{ color: 'var(--c-good)' }} aria-hidden="true" />
              <strong className="text-sm" style={{ color: 'var(--c-good)' }}>Outcome Verified</strong>
              <span className="text-xs text-muted">· {formatDateTime(report.verifiedAt, tz, locale)}</span>
            </div>
            {report.verifiedBy ? <p className="text-xs m-0">Verified by: {report.verifiedBy}</p> : null}
            {report.verificationNote ? <p className="text-xs m-0 text-muted mt-1">{report.verificationNote}</p> : null}
          </div>
        ) : null}

        {report.status !== 'resolved' && report.status !== 'outcome_verified' && report.status !== 'follow_up_pending' ? (
          <Notice kind="info">{t('rep.reportedHazardNote')}</Notice>
        ) : null}
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
              {h.note ? <p className="m-0">{h.note}</p> : null}
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
  follow_up_pending: 'Schedule follow-up inspection',
  outcome_verified: 'Verify resolution outcome',
  reopened: 'Reopen',
};

function TransitionForm({ report, onUpdated }: { report: SafetyReportDTO; onUpdated: (r: SafetyReportDTO) => void }) {
  const options = allowedTransitions(report.status);
  const [to, setTo] = useState<ReportStatus>(options[0]!);
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState(report.assignee ?? '');
  const [actionTaken, setActionTaken] = useState(report.actionTaken ?? '');
  const [followUpDate, setFollowUpDate] = useState(report.followUpDate ?? '');
  const [verifiedBy, setVerifiedBy] = useState(report.verifiedBy ?? '');
  const [verificationNote, setVerificationNote] = useState(report.verificationNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const needsNote = to === 'resolved' || to === 'reopened' || to === 'follow_up_pending' || to === 'outcome_verified';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const updated = await api<SafetyReportDTO>(`/admin/reports/${report.id}/transition`, {
        method: 'POST',
        body: {
          to,
          note,
          assignee: assignee.trim() || null,
          actionTaken: to === 'resolved' ? (actionTaken.trim() || null) : undefined,
          followUpDate: to === 'follow_up_pending' ? (followUpDate || null) : undefined,
          verifiedBy: to === 'outcome_verified' ? (verifiedBy.trim() || null) : undefined,
          verificationNote: to === 'outcome_verified' ? (verificationNote.trim() || null) : undefined,
        },
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

        {to === 'resolved' ? (
          <Field label="Corrective Action Taken" hint="Describe the physical fix, engineering control, or policy change." optional error={error?.fields['actionTaken']}>
            <input value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} placeholder="e.g. Guardrail installed with toe boards" maxLength={500} />
          </Field>
        ) : null}

        {to === 'follow_up_pending' ? (
          <Field label="Follow-Up Inspection Date" hint="Date by which effectiveness must be physically inspected." optional error={error?.fields['followUpDate']}>
            <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
          </Field>
        ) : null}

        {to === 'outcome_verified' ? (
          <>
            <Field label="Verified By" hint="Name of auditor, safety inspector, or confirming supervisor." optional error={error?.fields['verifiedBy']}>
              <input value={verifiedBy} onChange={(e) => setVerifiedBy(e.target.value)} placeholder="e.g. Suresh Rao (Site Auditor)" maxLength={80} />
            </Field>
            <Field label="Verification Note" hint="Details of inspection check or verification test results." optional error={error?.fields['verificationNote']}>
              <textarea value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} placeholder="e.g. Physical test passed at 50 Nm. Zero deflection." maxLength={1000} />
            </Field>
          </>
        ) : null}

        <Field
          label={needsNote ? 'Note (required)' : 'Note'}
          hint={needsNote ? 'Explain what was done, why it is being updated, or what was observed. The reporter can read this.' : 'Visible to the reporter.'}
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
