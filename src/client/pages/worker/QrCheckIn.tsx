// Site QR check-in. Reached by scanning the code on the site screen (phone camera or in-app
// scanner). The worker first sees which site the code belongs to; nothing is recorded until they
// confirm, and then the server checks the code again (expiry by its own clock, site, replay) along
// with their sign-in and, if they have one, their passkey.
import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, CircleAlert, CircleCheck, KeyRound, LogIn, MapPin, WifiOff } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { attendanceAssertion, isCancelled } from '../../lib/passkey';
import { useI18n, type MessageKey } from '../../lib/i18n';
import { useMe } from '../../lib/session';
import { useOnline } from '../../lib/online';
import { Link } from '../../lib/router';
import { formatTime } from '../../lib/format';
import type { PasskeysResponse, QrResolveDTO, ShiftDTO } from '../../../shared/types';
import { Button, Loading, Page } from '../../components/ui';
import { QrScanButton } from '../../components/QrScanner';

const ERROR_KEYS: Record<string, MessageKey> = {
  QR_EXPIRED: 'qr.errExpired',
  QR_INVALID: 'qr.errInvalid',
  QR_INACTIVE: 'qr.errInactive',
  SITE_INACTIVE: 'qr.errSiteInactive',
  QR_ALREADY_USED: 'qr.alreadyUsed',
  ALREADY_ON_SHIFT: 'qr.alreadyOnShift',
  VALIDATION: 'qr.errInvalid',
  PASSKEY_CANCELLED: 'pk.cancelled',
  PASSKEY_FAILED: 'pk.deviceFailed',
};

type State =
  | { step: 'checking' }
  | { step: 'ready'; site: QrResolveDTO }
  | { step: 'done'; site: QrResolveDTO; shift: ShiftDTO }
  | { step: 'error'; code: string; message: string };

export function WorkerQrCheckIn({ token }: { token: string }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const online = useOnline();
  const [state, setState] = useState<State>({ step: 'checking' });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    api<QrResolveDTO>('/attendance/qr/resolve', { method: 'POST', body: { token } })
      .then((site) => !cancelled && setState({ step: 'ready', site }))
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e instanceof ApiError ? e : new ApiError(0, 'ERROR', t('common.error'));
        setState({ step: 'error', code: err.code, message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [token, online, t]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [state.step]);

  async function confirm(site: QrResolveDTO) {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { qrToken: token };
      const passkeys = await api<PasskeysResponse>('/passkeys');
      if (passkeys.required) {
        setConfirming(true);
        try {
          body.passkey = await attendanceAssertion('check-in');
        } catch (err) {
          throw err instanceof ApiError ? err : new ApiError(0, isCancelled(err) ? 'PASSKEY_CANCELLED' : 'PASSKEY_FAILED', t('pk.deviceFailed'));
        } finally {
          setConfirming(false);
        }
      }
      const shift = await api<ShiftDTO>('/attendance/check-in', { method: 'POST', body });
      setState({ step: 'done', site, shift });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'ERROR', t('common.error'));
      setState({ step: 'error', code: err.code, message: err.message });
    } finally {
      setBusy(false);
    }
  }

  const tz = me.org.timezone;
  let body;
  if (!online) {
    body = (
      <div className="qr-result qr-result-bad" role="alert">
        <WifiOff className="icon-lg" aria-hidden="true" />
        <p>{t('off.qrNeedsConnection')}</p>
      </div>
    );
  } else if (state.step === 'checking') {
    body = (
      <>
        <p className="muted">{t('qr.checking')}</p>
        <Loading />
      </>
    );
  } else if (state.step === 'ready') {
    const s = state.site;
    body = (
      <div className="qr-confirm">
        <div className="qr-site">
          <span className="badge badge-good">
            <BadgeCheck className="icon-xs" aria-hidden="true" />
            {t('qr.siteVerified')}
          </span>
          <p className="qr-site-name">
            <MapPin className="icon" aria-hidden="true" />
            <strong>{s.siteName}</strong>
          </p>
          {s.siteAddress ? <p className="muted m-0">{s.siteAddress}</p> : null}
        </div>
        {s.alreadyUsed ? (
          <p className="qr-result qr-result-bad">
            <CircleAlert className="icon" aria-hidden="true" />
            {t('qr.alreadyUsed')}
          </p>
        ) : (
          <>
            <p>{t('qr.confirmBody', { time: formatTime(s.expiresAt, tz, locale) })}</p>
            {confirming ? (
              <p className="timecard-message">
                <KeyRound className="icon" aria-hidden="true" />
                {t('pk.confirming')}
              </p>
            ) : null}
            <Button className="btn btn-primary btn-big" busy={busy} onClick={() => void confirm(s)}>
              <LogIn className="icon" aria-hidden="true" />
              {t('qr.confirm')}
            </Button>
          </>
        )}
        <p className="muted small">{t('qr.howItWorks')}</p>
      </div>
    );
  } else if (state.step === 'done') {
    body = (
      <div className="qr-result qr-result-good" role="status">
        <CircleCheck className="icon-lg" aria-hidden="true" />
        <p>
          <strong>{t('qr.success', { site: state.site.siteName })}</strong>
        </p>
        <p className="muted m-0">{t('att.since', { time: formatTime(state.shift.checkInAt, tz, locale) })}</p>
        <Link to="/worker/attendance" className="btn btn-secondary">
          {t('qr.goAttendance')}
        </Link>
      </div>
    );
  } else {
    const key = ERROR_KEYS[state.code];
    body = (
      <div className="qr-result qr-result-bad" role="alert">
        <CircleAlert className="icon-lg" aria-hidden="true" />
        <p>
          <strong>{t('qr.failed')}</strong>
        </p>
        <p className="m-0">{key ? t(key) : state.message}</p>
        <div className="btn-group">
          <QrScanButton className="btn btn-primary" />
          <Link to="/worker/attendance" className="btn btn-quiet">
            {t('qr.goAttendance')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Page title={t('qr.pageTitle')}>
      <h2 className="visually-hidden" ref={headingRef} tabIndex={-1}>
        {state.step === 'ready' ? t('qr.confirmTitle', { site: state.site.siteName }) : t('qr.pageTitle')}
      </h2>
      <section className="card qr-checkin">{body}</section>
    </Page>
  );
}
