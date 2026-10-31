// The time card: today's attendance state, recorded hours against the scheduled day, and the
// one action that matters (check in or check out). Hours come from the server; the only value
// computed here is how long the open shift has been running, shown as "so far".
import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, CircleCheck, CloudOff, CloudUpload, KeyRound, LogIn, LogOut, ShieldCheck } from 'lucide-react';
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
import { QrScanButton } from './QrScanner';
import { useOutbox } from '../lib/outboxContext';
import { isUnsent } from '../lib/outbox';
import type { AttendanceState } from '../../shared/types';

const lastStateKey = (userId: string) => `fairshift.lastState.${userId}`;

function readLastState(userId: string): AttendanceState | null {
  try {
    const v = localStorage.getItem(lastStateKey(userId));
    return v === 'on_shift' || v === 'not_started' || v === 'completed' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Shown when the server cannot be reached. The worker can save a check-in or check-out on the
 * phone; it is labelled pending verification and only counts once the server confirms it.
 */
function OfflineTimecard({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  const me = useMe();
  const outbox = useOutbox();
  const [message, setMessage] = useState<string | null>(null);
  const last = readLastState(me.user.id);
  const pending = outbox?.items.find((i) => i.kind !== 'report' && isUnsent(i));
  const save = (kind: 'check-in' | 'check-out') => {
    if (!outbox) return;
    const r = outbox.enqueue({ kind });
    setMessage(r.ok ? t(kind === 'check-in' ? 'off.savedCheckIn' : 'off.savedCheckOut') : t('off.duplicate'));
  };
  const showIn = last !== 'on_shift';
  const showOut = last !== 'not_started' && last !== 'completed';
  return (
    <section className="timecard timecard-idle timecard-offline on-dark" aria-labelledby="timecard-offline">
      <div className="timecard-head">
        <p className="timecard-state" id="timecard-offline">
          <CloudOff className="icon-sm" aria-hidden="true" />
          {t('off.timecardTitle')}
        </p>
      </div>
      <p className="timecard-note">{t('off.timecardBody', { state: last ? t(`state.${last}`) : t('off.lastKnownUnknown') })}</p>
      <div className="timecard-feedback" aria-live="polite">
        {pending ? (
          <p className="timecard-message">
            <CloudUpload className="icon" aria-hidden="true" />
            {t(pending.kind === 'check-in' ? 'off.kindCheckIn' : 'off.kindCheckOut')}: {t('off.pendingVerification')}
          </p>
        ) : null}
        {message ? <p className="timecard-message">{message}</p> : null}
      </div>
      {outbox && !pending ? (
        <div className="timecard-checkin">
          {showIn ? (
            <Button className="btn btn-primary btn-big" onClick={() => save('check-in')}>
              <LogIn className="icon" aria-hidden="true" />
              {t('off.saveCheckIn')}
            </Button>
          ) : null}
          {showOut ? (
            <Button className={showIn ? 'btn btn-secondary' : 'btn btn-primary btn-big'} onClick={() => save('check-out')}>
              <LogOut className="icon" aria-hidden="true" />
              {t('off.saveCheckOut')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="timecard-foot">
        <p className="timecard-note">{t('off.qrNeedsConnection')}</p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onRetry}>
          {t('common.retry')}
        </button>
      </div>
    </section>
  );
}

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
  const [offerQueue, setOfferQueue] = useState<'check-in' | 'check-out' | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const outbox = useOutbox();
  const s = status.data;
  const onShift = s?.state === 'on_shift' && s.openShift !== null;
  const now = useNow(onShift);
  const { reload } = status;
  const syncedVersion = outbox?.syncedVersion ?? 0;
  const pendingAttendance = outbox?.items.find((i) => i.kind !== 'report' && isUnsent(i));

  // A saved check-in confirmed by the server: show the recorded state
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const seenSynced = useRef(syncedVersion);
  useEffect(() => {
    if (syncedVersion === seenSynced.current) return;
    seenSynced.current = syncedVersion;
    reload();
    onChangeRef.current?.();
  }, [syncedVersion, reload]);

  // Remember the last state the server reported, for the offline card
  useEffect(() => {
    if (!s) return;
    try {
      localStorage.setItem(lastStateKey(me.user.id), s.state);
    } catch {
      /* storage unavailable */
    }
  }, [s, me.user.id]);

  async function act(kind: 'check-in' | 'check-out') {
    setConfirmOut(false);
    setBusy(true);
    setError(null);
    setMessage(null);
    setOfferQueue(null);
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
      const err = e instanceof ApiError ? e : new ApiError(0, 'ERROR', t('common.error'));
      setError(err);
      // Lost connection: offer to keep it on the phone instead (a site code is kept with it)
      if (err.status === 0 && err.code === 'NETWORK' && outbox) setOfferQueue(kind);
      status.reload();
    } finally {
      setBusy(false);
    }
  }

  if (status.error) {
    if (status.error.status === 0 && outbox) return <OfflineTimecard onRetry={status.reload} />;
    return <ErrorBox error={status.error} onRetry={status.reload} />;
  }
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
        ) : open?.checkInMethod === 'site_qr' ? (
          <span className="timecard-site">
            <BadgeCheck className="icon-sm" aria-hidden="true" />
            {t('qr.methodLabel', { site: open.siteName ?? '' })}
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
        {offerQueue && outbox ? (
          <Button
            className="btn btn-secondary"
            onClick={() => {
              const r = outbox.enqueue({ kind: offerQueue, siteCode: offerQueue === 'check-in' && siteCode ? siteCode : undefined });
              setOfferQueue(null);
              setError(null);
              setMessage(r.ok ? t(offerQueue === 'check-in' ? 'off.savedCheckIn' : 'off.savedCheckOut') : t('off.duplicate'));
            }}
          >
            <CloudUpload className="icon" aria-hidden="true" />
            {t(offerQueue === 'check-in' ? 'off.saveCheckIn' : 'off.saveCheckOut')}
          </Button>
        ) : null}
        {pendingAttendance ? (
          <p className="timecard-message">
            <CloudUpload className="icon" aria-hidden="true" />
            {t(pendingAttendance.kind === 'check-in' ? 'off.kindCheckIn' : 'off.kindCheckOut')}: {t('off.pendingVerification')}
          </p>
        ) : null}
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
          <QrScanButton className="btn btn-secondary timecard-qr" />
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
