// Check-in / check-out control showing the explicit attendance state.
import { useState } from 'react';
import { BadgeCheck, LogIn, LogOut } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useApi } from '../lib/useApi';
import { formatMinutes, formatTime } from '../lib/format';
import { useMe } from '../lib/session';
import type { AttendanceStatusDTO, ShiftDTO } from '../../shared/types';
import { Button, Card, ErrorBox, Field, Loading, Notice, Stat } from './ui';
import { ReadAloudButton } from './Voice';

export function ShiftCard({ onChange }: { onChange?: () => void }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const status = useApi<AttendanceStatusDTO>('/attendance/status');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [siteCode, setSiteCode] = useState('');

  async function act(kind: 'check-in' | 'check-out') {
    if (kind === 'check-out' && !window.confirm(t('att.confirmOut'))) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = kind === 'check-in' && siteCode ? { siteCode } : {};
      const shift = await api<ShiftDTO>(`/attendance/${kind}`, { method: 'POST', body });
      setMessage(kind === 'check-in' ? t('att.checkedIn') : t('att.checkedOut', { hours: formatMinutes(shift.durationMinutes ?? 0) }));
      setSiteCode('');
      status.reload();
      onChange?.();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', t('common.error')));
      status.reload();
    } finally {
      setBusy(false);
    }
  }

  if (status.error) return <ErrorBox error={status.error} onRetry={status.reload} />;
  if (!status.data) return <Loading />;
  const s = status.data;
  const tone = s.state === 'on_shift' ? 'good' : s.state === 'completed' ? 'info' : 'neutral';
  const since = s.openShift ? t('att.since', { time: formatTime(s.openShift.checkInAt, me.org.timezone, locale) }) : '';
  const spoken = [t(`state.${s.state}`), since, `${t('att.worked')}: ${formatMinutes(s.today.workedMinutes)}`].filter(Boolean).join('. ');
  const codeField = (
    <Field label={t('site.label')} hint={t('site.hint')} error={error?.fields['siteCode']}>
      <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={siteCode} onChange={(e) => setSiteCode(e.target.value.replace(/\D/g, ''))} />
    </Field>
  );

  return (
    <Card className="shift-card">
      <div className="state-text">
        <p className="shift-state">
          <span className={`state-dot state-dot-${tone}`} aria-hidden="true" />
          {t(`state.${s.state}`)}
        </p>
      </div>
      {s.openShift ? (
        <p className="muted">
          {since}
          {s.openShift.checkInMethod === 'site_code' ? (
            <>
              {' · '}
              <span className="site-verified">
                <BadgeCheck className="icon" aria-hidden="true" data-size="sm" />
                {t('site.verified')}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
      <div aria-live="polite">
        {message ? <Notice kind="success">{message}</Notice> : null}
        {error && !Object.keys(error.fields).length ? <ErrorBox error={error} /> : null}
      </div>
      {s.state === 'on_shift' ? (
        <Button className="btn btn-danger btn-big" busy={busy} onClick={() => act('check-out')}>
          <LogOut className="icon" aria-hidden="true" />
          {t('att.checkOut')}
        </Button>
      ) : (
        <>
          {s.requireSiteCode ? (
            <>
              <p className="small muted">{t('site.required')}</p>
              {codeField}
            </>
          ) : (
            <details>
              <summary>{t('site.have')}</summary>
              {codeField}
            </details>
          )}
          <Button className="btn btn-primary btn-big" busy={busy} onClick={() => act('check-in')}>
            <LogIn className="icon" aria-hidden="true" />
            {t('att.checkIn')}
          </Button>
        </>
      )}
      <div className="stats">
        <Stat label={t('att.worked')} value={formatMinutes(s.today.workedMinutes)} />
        <Stat label={t('att.overtime')} value={formatMinutes(s.today.overtimeMinutes)} />
      </div>
      <div className="row">
        <p className="muted small m-0">{t('att.scheduled', { hours: formatMinutes(s.scheduledDailyMinutes) })}</p>
        <ReadAloudButton text={spoken} className="btn-link" />
      </div>
    </Card>
  );
}
