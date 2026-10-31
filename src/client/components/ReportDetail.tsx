// A safety report as a case: what was reported, where it is in the accountability loop, what
// was done, and every recorded step. Admins also get the transition form.
import { useState } from 'react';
import { CalendarCheck, ClipboardCheck, EyeOff, Wrench } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { useMe } from '../lib/session';
import { formatDate, formatDateTime } from '../lib/format';
import { allowedTransitions } from '../../domain/safety';
import { getIndustry } from '../../shared/industries';
import type { ReportStatus, SafetyReportDTO } from '../../shared/types';
import { Button, Card, ErrorBox, Field, Notice, ReportStatusBadge, SeverityBadge } from './ui';
import { LifecycleSteps } from './Lifecycle';
import { EvidenceGallery, FixResponse } from './Evidence';

export function ReportDetail({ report, onUpdated }: { report: SafetyReportDTO; onUpdated?: (r: SafetyReportDTO) => void }) {
  const { t, locale, category } = useI18n();
  const me = useMe();
  const tz = me.org.timezone;
  const cat = getIndustry(me.org.industry).hazardCategories.find((c) => c.key === report.category);
  const open = report.status !== 'resolved' && report.status !== 'outcome_verified' && report.status !== 'follow_up_pending';
  const history = report.history ?? [];

  return (
    <>
      <article className="case" aria-labelledby="case-title">
        <header className="case-head">
          <h2 id="case-title" className="case-title">
            {report.title}
          </h2>
          <div className="case-tags">
            <ReportStatusBadge status={report.status} />
            <SeverityBadge severity={report.severity} />
            {report.confidential ? (
              <span className="badge badge-info">
                <EyeOff className="icon-xs" aria-hidden="true" />
                {t('rep.confidentialTag')}
              </span>
            ) : null}
          </div>
          <p className="case-meta">
            {t('rep.reportedOn', { date: formatDateTime(report.createdAt, tz, locale) })}
            <br />
            {category('hazard', report.category, cat?.label ?? report.category)}, {report.siteName ? `${report.siteName}, ` : ''}
            {report.location}
          </p>
          {report.inspectionChecks?.length ? (
            <ul className="case-checks" aria-label={t('insp.pointedOut')}>
              {report.inspectionChecks.map((c) => (
                <li key={c} className="badge badge-warn">
                  {t(`insp.${c}` as MessageKey)}
                </li>
              ))}
            </ul>
          ) : null}
        </header>

        <LifecycleSteps status={report.status} followUpDate={report.followUpDate ? formatDate(report.followUpDate, locale) : null} />

        <section className="case-section" aria-labelledby="case-what">
          <h3 id="case-what">{t('rep.whatReported')}</h3>
          <p className="pre-wrap">{report.description}</p>
          <dl className="case-facts">
            <div>
              <dt>{t('rep.reporter')}</dt>
              <dd>{report.reporterName ?? (report.confidential ? t('rep.reporterProtected') : '—')}</dd>
            </div>
            <div>
              <dt>{t('rep.assignee')}</dt>
              <dd>{report.assignee ?? t('rep.notAssigned')}</dd>
            </div>
          </dl>
        </section>

        <EvidenceGallery report={report} onUpdated={onUpdated} />

        {me.user.role === 'admin' && report.closure?.policy === 'two_key' && (report.status === 'resolved' || report.status === 'follow_up_pending') ? (
          <ClosureStatus report={report} />
        ) : null}

        {me.user.role !== 'admin' && onUpdated ? <FixResponse report={report} onUpdated={onUpdated} /> : null}

        {report.actionTaken ? (
          <section className="case-section case-done" aria-labelledby="case-action">
            <h3 id="case-action">
              <Wrench className="icon" aria-hidden="true" />
              {t('rep.whatDone')}
            </h3>
            <p className="pre-wrap">{report.actionTaken}</p>
          </section>
        ) : null}

        {report.followUpDate ? (
          <p className="case-followup">
            <CalendarCheck className="icon" aria-hidden="true" />
            {t('life.followUpOn', { date: formatDate(report.followUpDate, locale) })}
          </p>
        ) : null}

        {report.verifiedAt ? (
          <section className="case-section case-verified" aria-labelledby="case-verified">
            <h3 id="case-verified">
              <ClipboardCheck className="icon" aria-hidden="true" />
              {t('rep.outcomeChecked')}
            </h3>
            <p className="m-0">{formatDateTime(report.verifiedAt, tz, locale)}</p>
            {report.verifiedBy ? <p className="m-0">{t('rep.checkedBy', { name: report.verifiedBy })}</p> : null}
            {report.verificationNote ? <p className="case-note">{report.verificationNote}</p> : null}
          </section>
        ) : null}

        {/* Addressed to the worker ("your employer"), so administrators do not see it */}
        {open && me.user.role !== 'admin' ? <Notice kind="info">{t('rep.reportedHazardNote')}</Notice> : null}
        {report.synthetic ? <p className="case-foot">{t('rep.syntheticNote')}</p> : null}
      </article>

      <section className="case-history" aria-labelledby="case-history">
        <h2 id="case-history" className="section-title">
          {t('rep.history')}
        </h2>
        <ol className="timeline">
          {history.map((h) => (
            <li key={h.id}>
              <span className="timeline-dot" aria-hidden="true" />
              <div className="timeline-body">
                <p className="timeline-title">{t(`status.${h.toStatus}`)}</p>
                <p className="timeline-meta">
                  {formatDateTime(h.createdAt, tz, locale)}, {h.actorLabel}
                </p>
                {h.note ? <p className="timeline-note">{h.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {me.user.role === 'admin' && onUpdated ? <TransitionForm report={report} onUpdated={onUpdated} /> : null}
    </>
  );
}

/** Where a two-key closure stands, for administrators. */
function ClosureStatus({ report }: { report: SafetyReportDTO }) {
  const { locale } = useI18n();
  const me = useMe();
  const c = report.closure!;
  const at = c.escalationAt ? formatDateTime(c.escalationAt, me.org.timezone, locale) : null;
  const passed = c.escalationOpen;
  return (
    <Notice kind={c.workerResponse === 'confirmed' ? 'success' : 'info'}>
      {c.workerResponse === 'confirmed'
        ? 'The reporter confirmed the fix. The outcome can now be verified.'
        : passed
          ? `The reporter has not answered since ${at}. An administrator other than the one who resolved the report can now verify the outcome; it will be recorded as escalated.`
          : `Waiting for the reporter to confirm or dispute the fix. If they do not answer by ${at}, an administrator other than the one who resolved it can verify the outcome.`}
    </Notice>
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
          actionTaken: to === 'resolved' ? actionTaken.trim() || null : undefined,
          followUpDate: to === 'follow_up_pending' ? followUpDate || null : undefined,
          verifiedBy: to === 'outcome_verified' ? verifiedBy.trim() || null : undefined,
          verificationNote: to === 'outcome_verified' ? verificationNote.trim() || null : undefined,
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
          <Field
            label="Corrective Action Taken"
            hint="Describe the physical fix, engineering control, or policy change."
            optional
            error={error?.fields['actionTaken']}
          >
            <input
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              placeholder="e.g. Guardrail installed with toe boards"
              maxLength={500}
            />
          </Field>
        ) : null}

        {to === 'follow_up_pending' ? (
          <Field
            label="Follow-Up Inspection Date"
            hint="Date by which effectiveness must be physically inspected."
            optional
            error={error?.fields['followUpDate']}
          >
            <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
          </Field>
        ) : null}

        {to === 'outcome_verified' ? (
          <>
            <Field label="Verified By" hint="Name of auditor, safety inspector, or confirming supervisor." optional error={error?.fields['verifiedBy']}>
              <input value={verifiedBy} onChange={(e) => setVerifiedBy(e.target.value)} placeholder="e.g. Suresh Rao (Site Auditor)" maxLength={80} />
            </Field>
            <Field
              label="Verification Note"
              hint="Details of inspection check or verification test results."
              optional
              error={error?.fields['verificationNote']}
            >
              <textarea
                value={verificationNote}
                onChange={(e) => setVerificationNote(e.target.value)}
                placeholder="e.g. Physical test passed at 50 Nm. Zero deflection."
                maxLength={1000}
              />
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
