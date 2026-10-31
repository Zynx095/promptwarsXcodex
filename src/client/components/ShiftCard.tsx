// The time card: today's attendance state, recorded hours against the scheduled day, and the
// one action that matters (check in or check out). Hours come from the server; the only value
// computed here is how long the open shift has been running, shown as "so far".
import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, CircleCheck, KeyRound, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { attendanceAssertion, isCancelled } from '../lib/passkey';
import { Link } from '../lib/router';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useApi } from '../lib/useApi';
import { formatDateTime, formatMinutes, formatTime } from '../lib/format';
import { useMe } from '../lib/session';
import type { AttendanceStatusDTO, PasskeysResponse, ShiftDTO } from '../../shared/types';
import { Button, ConfirmDialog, ErrorBox, Field, Skeleton } from './ui';
import { ReadAloudButton } from './Voice';

function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

/** Re-renders every 30 s while a shift is open so the running time stays current. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function ShiftCard({ onChange }: { onChange?: () => void }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const tz = me.org.timezone;
  const status = useApi<AttendanceStatusDTO>('/attendance/status');
  const passkeys = useApi<PasskeysResponse>('/passkeys');
  const passkeyOn = Boolean(passkeys.data?.required);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [siteCode, setSiteCode] = useState('');
  const [confirmOut, setConfirmOut] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const s = status.data;
  const onShift = s?.state === 'on_shift' && s.openShift !== null;
  const now = useNow(onShift);

  async function act(kind: 'check-in' | 'check-out') {
    setConfirmOut(false);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body: Record<string, unknown> = kind === 'check-in' && siteCode ? { siteCode } : {};
      if (passkeyOn) {
        // The phone's own check (fingerprint, face or PIN); the server verifies the answer
        setConfirming(true);
        try {
          body.passkey = await attendanceAssertion(kind);
        } catch (err) {
          throw isCancelled(err)
            ? new ApiError(0, 'PASSKEY_CANCELLED', t('pk.cancelled'))
            : err instanceof ApiError
              ? err
              : new ApiError(0, 'PASSKEY_FAILED', t('pk.deviceFailed'));
        } finally {
          setConfirming(false);
        }
      }
      const shift = await api<ShiftDTO>(`/attendance/${kind}`, { method: 'POST', body });
      setMessage(kind === 'check-in' ? t('att.checkedIn') : t('att.checkedOut', { hours: formatMinutes(shift.durationMinutes ?? 0) }));
      setSiteCode('');
      status.reload();
      onChange?.();
      statusRef.current?.focus();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', t('common.error')));
      status.reload();
    } finally {
      setBusy(false);
    }
  }

  if (status.error) return <ErrorBox error={status.error} onRetry={status.reload} />;
  if (!s) {
    return (
      <section className="timecard timecard-loading on-dark" aria-busy="true">
        <Skeleton height={18} width="55%" />
        <Skeleton height={56} width="45%" />
        <Skeleton height={56} width="100%" />
      </section>
    );
  }

  const open = s.openShift;
  const running = open ? minutesSince(open.checkInAt, now) : 0;
  const recorded = s.today.workedMinutes;
  const scheduled = s.scheduledDailyMinutes;
  // Ruler scale: the scheduled day with headroom, stretched if the day ran longer.
  const scale = Math.max(scheduled * 1.25, (recorded + running) * 1.08, 60);
  const pct = (m: number) => `${Math.min(100, (m / scale) * 100)}%`;
  const recordedRegular = Math.max(0, recorded - s.today.overtimeMinutes);
  // A shift that began on an earlier day (e.g. a night shift) shows its date as well as the time.
  const startedEarlier = open !== null && open.localDate !== s.today.date;
  const checkInText = open ? (startedEarlier ? formatDateTime(open.checkInAt, tz, locale) : formatTime(open.checkInAt, tz, locale)) : '';
  const since = open ? t('att.since', { time: checkInText }) : '';
  const tone = s.state === 'on_shift' ? 'live' : s.state === 'completed' ? 'done' : 'idle';
  // Before the first check-in of the day the ruler and facts carry nothing, so the action moves up.
  const nothingYet = !open && recorded === 0;
  // A night shift that began yesterday is shown on its own; the total is not counted as today's.
  const heroMinutes = startedEarlier ? running : recorded + running;
  const heroLabel = startedEarlier ? t('att.shiftSoFar') : open ? t('att.workedSoFar') : t('att.worked');
  const spoken = [t(`state.${s.state}`), since, `${heroLabel}: ${formatMinutes(heroMinutes)}`].filter(Boolean).join('. ');

  const codeField = (
    <Field label={t('site.label')} hint={t('site.hint')} error={error?.fields['siteCode']}>
      <input
        className="timecard-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={siteCode}
        onChange={(e) => setSiteCode(e.target.value.replace(/\D/g, ''))}
      />
    </Field>
  );

  return (
    <section className={`timecard timecard-${tone} on-dark`} aria-labelledby="timecard-state">
      <div className="timecard-head">
        <p className="timecard-state" id="timecard-state" ref={statusRef} tabIndex={-1}>
          <span className="timecard-dot" aria-hidden="true" />
          {t(`state.${s.state}`)}
        </p>
        {open?.checkInMethod === 'site_code' ? (
          <span className="timecard-site">
            <BadgeCheck className="icon-sm" aria-hidden="true" />
            {t('site.verified')}
          </span>
        ) : null}
      </div>

      <div className="timecard-figure">
        <span className="figure timecard-hours">{formatMinutes(heroMinutes)}</span>
        <span className="timecard-figure-label">{heroLabel}</span>
      </div>

      {nothingYet ? null : (
        <div className="timecard-ruler" aria-hidden="true">
          <div className="ruler-track">
            <span className="ruler-recorded" style={{ width: pct(recordedRegular) }} />
            <span className="ruler-overtime" style={{ left: pct(recordedRegular), width: pct(s.today.overtimeMinutes) }} />
            {open ? <span className="ruler-running" style={{ left: pct(recorded), width: pct(running) }} /> : null}
            <span className="ruler-mark" style={{ left: pct(scheduled) }} />
          </div>
          <div className="ruler-scale">
            <span>0h</span>
            <span className="ruler-mark-label" style={{ left: pct(scheduled) }}>
              {formatMinutes(scheduled)}
            </span>
          </div>
        </div>
      )}

      {nothingYet ? null : (
        <dl className="timecard-facts">
          {open ? (
            <div>
              <dt>{t('att.in')}</dt>
              <dd className="figure">{checkInText}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('att.overtime')}</dt>
            <dd className="figure">{formatMinutes(s.today.overtimeMinutes)}</dd>
          </div>
        </dl>
      )}

      <div className="timecard-feedback" aria-live="polite">
        {confirming ? (
          <p className="timecard-message timecard-confirming">
            <KeyRound className="icon" aria-hidden="true" />
            {t('pk.confirming')}
          </p>
        ) : null}
        {message ? (
          <p className="timecard-message">
            <CircleCheck className="icon" aria-hidden="true" />
            {message}
          </p>
        ) : null}
        {error && !Object.keys(error.fields).length ? <ErrorBox error={error} /> : null}
      </div>

      {s.state === 'on_shift' ? (
        <Button className="btn btn-primary btn-big" busy={busy} onClick={() => setConfirmOut(true)}>
          <LogOut className="icon" aria-hidden="true" />
          {t('att.checkOut')}
        </Button>
      ) : (
        <div className="timecard-checkin">
          {s.requireSiteCode ? (
            <>
              <p className="timecard-note">{t('site.required')}</p>
              {codeField}
            </>
          ) : (
            <details className="timecard-code-toggle">
              <summary>{t('site.have')}</summary>
              {codeField}
            </details>
          )}
          <Button className="btn btn-primary btn-big" busy={busy} onClick={() => act('check-in')}>
            <LogIn className="icon" aria-hidden="true" />
            {t('att.checkIn')}
          </Button>
        </div>
      )}

      <div className="timecard-foot">
        <p className="timecard-note">
          {t('att.scheduled', { hours: formatMinutes(scheduled) })}{' '}
          {passkeyOn ? (
            <span className="timecard-passkey">
              <ShieldCheck className="icon-xs" aria-hidden="true" />
              {t('pk.protected')}
            </span>
          ) : passkeys.data?.available ? (
            <Link to="/worker/security" className="timecard-passkey-link">
              {t('pk.offer')}
            </Link>
          ) : null}
        </p>
        <ReadAloudButton text={spoken} className="timecard-voice" />
      </div>

      <ConfirmDialog
        isOpen={confirmOut}
        title={t('att.confirmOutTitle')}
        message={t('att.confirmOutBody', { duration: formatMinutes(running) })}
        confirmLabel={t('att.confirmOutAction')}
        cancelLabel={t('att.keepWorking')}
        busy={busy}
        onConfirm={() => act('check-out')}
        onCancel={() => setConfirmOut(false)}
      />
    </section>
  );
}
