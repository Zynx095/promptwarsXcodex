// Photos on a safety report: before (as reported) and after (the fix), each with its seal check.
// Administrators also see the advisory analysis, record their review of it, and add photos of the
// fix; the reporter confirms or disputes the fix (two-key closure).
import { useState } from 'react';
import { CheckCircle2, ShieldCheck, ShieldX, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/session';
import { formatDateTime } from '../lib/format';
import type { EvidenceDTO, EvidenceOutcome, EvidenceVerificationDTO, SafetyReportDTO } from '../../shared/types';
import { Button, ErrorBox, Field, Notice } from './ui';
import { PhotoCapture, uploadPhotos, type DraftPhoto } from './PhotoCapture';

const OUTCOME_LABEL: Record<EvidenceOutcome, string> = {
  potential_hazard: 'Potential hazard detected',
  ppe_may_be_missing: 'Protective gear may be missing',
  manual_inspection_required: 'Manual inspection required',
  unable_to_determine: 'Unable to determine',
  no_visible_issue: 'No visible issue detected in this photo',
};
const OUTCOME_TONE: Record<EvidenceOutcome, string> = {
  potential_hazard: 'bad',
  ppe_may_be_missing: 'warn',
  manual_inspection_required: 'warn',
  unable_to_determine: 'neutral',
  no_visible_issue: 'neutral',
};
const KIND_LABEL: Record<string, string> = {
  fire: 'Fire or smoke',
  electrical: 'Electrical equipment',
  machinery: 'Machinery',
  structure: 'Structure or work at height',
  chemical: 'Chemicals or containers',
  helmet: 'Helmet',
  vest: 'High-visibility vest',
  footwear: 'Safety footwear',
  eye: 'Eye protection',
  gloves: 'Gloves',
};

export function outcomeLabel(o: EvidenceOutcome): string {
  return OUTCOME_LABEL[o];
}
export function outcomeTone(o: EvidenceOutcome): string {
  return OUTCOME_TONE[o];
}

export function imageUrl(reportId: string, evidenceId: string): string {
  return `/api/reports/${encodeURIComponent(reportId)}/evidence/${encodeURIComponent(evidenceId)}/image`;
}

export function EvidenceGallery({ report, onUpdated }: { report: SafetyReportDTO; onUpdated?: (r: SafetyReportDTO) => void }) {
  const { t } = useI18n();
  const me = useMe();
  const admin = me.user.role === 'admin';
  const evidence = report.evidence ?? [];
  const before = evidence.filter((e) => e.stage === 'hazard');
  const after = evidence.filter((e) => e.stage === 'remediation');
  if (!before.length && !after.length && !admin) return null;

  return (
    <section className="case-section evidence" aria-labelledby="case-photos">
      <h3 id="case-photos">{t('ev.title')}</h3>
      <div className="evidence-columns">
        <div className="evidence-col">
          <h4>{t('ev.before')}</h4>
          {before.length ? (
            <ul className="evidence-list">
              {before.map((e, i) => (
                <EvidenceItem key={e.id} report={report} e={e} alt={t('ev.alt', { n: i + 1 })} admin={admin} onUpdated={onUpdated} />
              ))}
            </ul>
          ) : (
            <p className="evidence-empty">{t('ev.noBefore')}</p>
          )}
        </div>
        <div className="evidence-col">
          <h4>{t('ev.after')}</h4>
          {after.length ? (
            <ul className="evidence-list">
              {after.map((e, i) => (
                <EvidenceItem key={e.id} report={report} e={e} alt={t('ev.altAfter', { n: i + 1 })} admin={admin} onUpdated={onUpdated} />
              ))}
            </ul>
          ) : (
            <p className="evidence-empty">{t('ev.noAfter')}</p>
          )}
        </div>
      </div>
      {admin && onUpdated && report.status !== 'outcome_verified' ? <FixPhotoUpload report={report} onUpdated={onUpdated} /> : null}
    </section>
  );
}

function EvidenceItem({
  report,
  e,
  alt,
  admin,
  onUpdated,
}: {
  report: SafetyReportDTO;
  e: EvidenceDTO;
  alt: string;
  admin: boolean;
  onUpdated?: (r: SafetyReportDTO) => void;
}) {
  const { t, locale } = useI18n();
  const me = useMe();
  const [check, setCheck] = useState<EvidenceVerificationDTO | 'busy' | 'error' | null>(null);
  const verify = async () => {
    setCheck('busy');
    try {
      setCheck(await api<EvidenceVerificationDTO>(`/reports/${encodeURIComponent(report.id)}/evidence/${encodeURIComponent(e.id)}/verify`));
    } catch {
      setCheck('error');
    }
  };
  const intact = typeof check === 'object' && check !== null && check.hashMatches && check.sealValid;

  return (
    <li className="evidence-item">
      <a href={imageUrl(report.id, e.id)} target="_blank" rel="noreferrer" className="evidence-frame">
        <img src={imageUrl(report.id, e.id)} alt={alt} loading="lazy" width={e.width} height={e.height} />
      </a>
      {e.caption ? <p className="evidence-caption">{e.caption}</p> : null}
      <p className="evidence-meta">
        {e.uploadedBy === 'Reporter' ? t('ev.byReporter') : e.uploadedBy}, {formatDateTime(e.createdAt, me.org.timezone, locale)}
      </p>
      <div className="evidence-seal">
        <button type="button" className="btn btn-link" onClick={() => void verify()} disabled={check === 'busy'}>
          {t('ev.check')}
        </button>
        <span aria-live="polite" className={check === null ? '' : intact ? 'seal-ok' : 'seal-bad'}>
          {check === 'busy' ? '…' : check === 'error' ? t('common.error') : check === null ? '' : intact ? t('ev.intact') : t('ev.altered')}
        </span>
        {check && typeof check === 'object' ? (
          <span className="evidence-hash">
            {intact ? <ShieldCheck className="icon-sm" aria-hidden="true" /> : <ShieldX className="icon-sm" aria-hidden="true" />}
            <code title={e.sha256}>SHA-256 {e.sha256.slice(0, 12)}…</code>
          </span>
        ) : null}
      </div>
      {admin ? <Advisory report={report} e={e} onUpdated={onUpdated} /> : null}
    </li>
  );
}

function Advisory({ report, e, onUpdated }: { report: SafetyReportDTO; e: EvidenceDTO; onUpdated?: (r: SafetyReportDTO) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  if (e.analysisStatus === 'not_configured') {
    return <p className="advisory advisory-off">Photo analysis is not set up on this server. Review the photo yourself.</p>;
  }
  if (e.analysisStatus === 'failed' || !e.analysis) {
    return <p className="advisory advisory-off">Photo analysis failed for this photo, so it has no advisory result. Review the photo yourself.</p>;
  }
  const a = e.analysis;
  const review = async (decision: 'confirmed' | 'dismissed') => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/reports/${encodeURIComponent(report.id)}/evidence/${encodeURIComponent(e.id)}/review`, { method: 'POST', body: { decision, note } });
      if (onUpdated) onUpdated(await api<SafetyReportDTO>(`/admin/reports/${encodeURIComponent(report.id)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Could not save the review.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="advisory">
      <p className="advisory-head">
        <Sparkles className="icon-sm" aria-hidden="true" />
        <span className={`badge badge-${OUTCOME_TONE[a.outcome]}`}>{OUTCOME_LABEL[a.outcome]}</span>
      </p>
      <p className="advisory-note">
        Advisory only, from {a.provider}. It can miss hazards and raise false ones; it never shows that a place is safe.
        {a.outcome === 'no_visible_issue' ? ' Nothing was flagged in this photo, which is not the same as the place being safe.' : ''}
      </p>
      {a.findings.length ? (
        <ul className="advisory-findings">
          {a.findings.map((f, i) => (
            <li key={i}>
              <strong>{KIND_LABEL[f.kind] ?? f.kind}:</strong> {OUTCOME_LABEL[f.outcome].toLowerCase()}
              <span className="advisory-signals"> ({f.signals.map((s) => `${s.name} ${Math.round(s.score * 100)}%`).join(', ')})</span>
            </li>
          ))}
        </ul>
      ) : null}
      <details className="advisory-labels">
        <summary>Everything the service recognised</summary>
        <p>{a.labels.map((l) => `${l.name} ${Math.round(l.score * 100)}%`).join(', ') || 'Nothing.'}</p>
      </details>
      {e.reviewStatus === 'pending' ? (
        <div className="advisory-review">
          <Field label="Your review" hint="Confirm or dismiss the advisory result after looking at the photo." optional>
            <input value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} placeholder="What you saw" />
          </Field>
          <div className="btn-group">
            <Button variant="secondary" busy={busy} onClick={() => void review('confirmed')}>
              <ThumbsUp className="icon" aria-hidden="true" />
              Confirm
            </Button>
            <Button variant="quiet" busy={busy} onClick={() => void review('dismissed')}>
              <ThumbsDown className="icon" aria-hidden="true" />
              Dismiss
            </Button>
          </div>
          {error ? <ErrorBox error={error} /> : null}
        </div>
      ) : (
        <p className="advisory-reviewed">
          <CheckCircle2 className="icon-sm" aria-hidden="true" />
          {e.reviewStatus === 'confirmed' ? 'Confirmed by a reviewer' : 'Dismissed by a reviewer'}
          {e.reviewNote ? `: ${e.reviewNote}` : ''}
        </p>
      )}
    </div>
  );
}

function FixPhotoUpload({ report, onUpdated }: { report: SafetyReportDTO; onUpdated: (r: SafetyReportDTO) => void }) {
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(0);
  const send = async () => {
    setBusy(true);
    const n = await uploadPhotos(report.id, 'remediation', photos);
    setFailed(n);
    if (n === 0) setPhotos([]);
    onUpdated(await api<SafetyReportDTO>(`/admin/reports/${encodeURIComponent(report.id)}`));
    setBusy(false);
  };
  return (
    <div className="fix-upload">
      <PhotoCapture
        photos={photos}
        onChange={setPhotos}
        legend="Add a photo of the fix"
        hint={
          report.closure?.policy === 'two_key'
            ? 'This report came with photos, so a photo of the fix is needed before it can be marked resolved. The reporter will compare the two.'
            : 'A photo of the fix helps the reporter check it.'
        }
      />
      {photos.length ? (
        <Button busy={busy} onClick={() => void send()}>
          Upload {photos.length} photo{photos.length === 1 ? '' : 's'}
        </Button>
      ) : null}
      {failed ? <Notice kind="warning">{failed} photo(s) could not be uploaded. Try again.</Notice> : null}
    </div>
  );
}

/** The reporter's answer to a fix: confirm, or dispute with what is still wrong. */
export function FixResponse({ report, onUpdated }: { report: SafetyReportDTO; onUpdated: (r: SafetyReportDTO) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'ask' | 'dispute'>('ask');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const awaiting = report.isMine && (report.status === 'resolved' || report.status === 'follow_up_pending') && !report.closure?.workerResponse;
  if (report.closure?.workerResponse === 'confirmed' && report.isMine) {
    return <Notice kind="success">{t('fix.confirmed')}</Notice>;
  }
  if (!awaiting) return null;

  const send = async (decision: 'confirmed' | 'disputed') => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await api<SafetyReportDTO>(`/reports/${encodeURIComponent(report.id)}/response`, { method: 'POST', body: { decision, note } }));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', t('common.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fix-response" aria-labelledby="fix-title">
      <h3 id="fix-title">{t('fix.title')}</h3>
      <p>{t('fix.body')}</p>
      {mode === 'ask' ? (
        <div className="btn-group">
          <Button busy={busy} onClick={() => void send('confirmed')}>
            <ThumbsUp className="icon" aria-hidden="true" />
            {t('fix.yes')}
          </Button>
          <Button variant="secondary" onClick={() => setMode('dispute')}>
            <ThumbsDown className="icon" aria-hidden="true" />
            {t('fix.no')}
          </Button>
        </div>
      ) : (
        <>
          <Field label={t('fix.whatWrong')} error={error?.fields['note']}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </Field>
          <div className="btn-group">
            <Button busy={busy} onClick={() => void send('disputed')}>
              {t('fix.send')}
            </Button>
            <Button variant="quiet" onClick={() => setMode('ask')}>
              {t('action.cancel')}
            </Button>
          </div>
        </>
      )}
      {report.closure?.policy === 'two_key' ? <p className="hint">{t('fix.window')}</p> : null}
      {error && !Object.keys(error.fields).length ? <ErrorBox error={error} /> : null}
    </section>
  );
}
