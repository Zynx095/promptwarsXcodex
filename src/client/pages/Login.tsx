import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { getIndustry } from '../../shared/industries';
import type { DemoAccount } from '../../shared/types';
import { Button, Card, ErrorBox, Field } from '../components/ui';
import { BrandMark, DemoBanner, LanguageSelect } from '../components/Layout';
import { Clock, Languages, MessageSquare, ShieldAlert } from 'lucide-react';

export function LoginPage() {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  // 404 when demo mode is off: the panel is simply not shown.
  const demo = useApi<{ accounts: DemoAccount[]; pinHint: string }>('/demo/accounts');
  const f = error?.fields ?? {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { phone, pin } });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {demo.data ? <DemoBanner /> : null}
      <main id="main" className="login">
        <section className="login-intro" aria-labelledby="login-heading">
          <div className="row">
            <div className="brand">
              <BrandMark />
              <span>FairShift</span>
            </div>
            <LanguageSelect />
          </div>
          <h1 id="login-heading">{t('login.heading')}</h1>
          <p className="lead">{t('app.tagline')}</p>
          <ul className="login-points">
            {(
              [
                [Clock, 'login.point1'],
                [ShieldAlert, 'login.point2'],
                [MessageSquare, 'login.point3'],
                [Languages, 'login.point4'],
              ] as const
            ).map(([Icon, key]) => (
              <li key={key}>
                <Icon className="icon" aria-hidden="true" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">{t('login.sdg')}</p>
        </section>
        <div>
          <Card title={t('login.title')}>
            <form onSubmit={submit} noValidate>
              {error && !Object.keys(f).length ? <ErrorBox error={error} /> : null}
              <Field label={t('login.phone')} hint={t('login.phoneHint')} error={f['phone']}>
                <input type="tel" inputMode="numeric" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value.trim())} maxLength={10} />
              </Field>
              <Field label={t('login.pin')} hint={t('login.pinHint')} error={f['pin']}>
                <input type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value.trim())} maxLength={6} />
              </Field>
              <Button type="submit" busy={busy} className="btn btn-primary btn-big">
                {t('action.signIn')}
              </Button>
            </form>
          </Card>
          {demo.data ? (
            <Card title={t('login.demoTitle')}>
              <p className="muted small">
                {t('login.demoHint')} {demo.data.pinHint}
              </p>
              <ul className="demo-accounts">
                {demo.data.accounts.map((a) => (
                  <li key={a.phone} className="demo-account">
                    <span style={{ minWidth: 0 }}>
                      <strong>{a.name}</strong>
                      <span className="muted">{a.role === 'admin' ? t('role.admin') : a.jobTitle}</span>
                      <br />
                      <span className="muted small">{getIndustry(a.industry).label.split(' (')[0]}</span>
                    </span>
                    <Button
                      variant="secondary"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setPhone(a.phone);
                        setPin('');
                        document.querySelector<HTMLInputElement>('input[type=password]')?.focus();
                      }}
                      aria-label={`${t('login.use')} ${a.name}`}
                    >
                      {t('login.use')}
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <p className="muted small">Sign-in uses a phone number and PIN issued by your employer. Demo accounts are fictional and exist only for demonstration.</p>
        </div>
      </main>
    </>
  );
}
