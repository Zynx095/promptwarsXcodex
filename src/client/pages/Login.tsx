import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { getIndustry } from '../../shared/industries';
import type { AuthConfigResponse, DemoAccount } from '../../shared/types';
import { Button, ErrorBox, Field, Notice } from '../components/ui';
import { BrandMark, DemoBanner } from '../components/Layout';
import { LanguagePicker } from '../components/LanguagePicker';
import { OverlayLayer } from '../components/Sheet';
import { MobileDemoQrModal } from '../components/MobileDemoQrModal';
import { Clock, KeyRound, Languages, MessageSquare, MessageSquareText, QrCode, ShieldAlert, Users } from 'lucide-react';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [showQr, setShowQr] = useState(false);

  // Authentication configuration
  const authConfig = useApi<AuthConfigResponse>('/auth/config');

  // Tabs: 'pin' | 'otp' | 'social'
  const [activeTab, setActiveTab] = useState<'pin' | 'otp' | 'social'>('pin');

  // Phone & PIN state
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  // Phone OTP state
  const [otpPhone, setOtpPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<ApiError | null>(null);

  // Demo accounts
  const demo = useApi<{ accounts: DemoAccount[]; pinHint: string }>('/demo/accounts');

  // Handle URL auth error query parameters
  const queryParams = useMemo(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''), []);
  const authErrorCode = queryParams.get('auth_error');
  const authEmail = queryParams.get('email');

  // Handle OTP cooldown ticker
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setInterval(() => {
      setOtpCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldown]);

  const f = error?.fields ?? {};
  const otpFields = otpError?.fields ?? {};

  async function submitPin(e: FormEvent) {
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

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    if (!otpPhone || otpCooldown > 0) return;
    setOtpBusy(true);
    setOtpError(null);
    try {
      await api('/auth/phone/otp/request', { method: 'POST', body: { phone: otpPhone } });
      setOtpSent(true);
      setOtpCooldown(60);
    } catch (err) {
      setOtpError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', t('common.error')));
    } finally {
      setOtpBusy(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!otpPhone || !otpCode) return;
    setOtpBusy(true);
    setOtpError(null);
    try {
      await api('/auth/phone/otp/verify', { method: 'POST', body: { phone: otpPhone, code: otpCode } });
      await refresh();
    } catch (err) {
      setOtpError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', t('common.error')));
    } finally {
      setOtpBusy(false);
    }
  }

  function renderAuthErrorBanner() {
    if (!authErrorCode) return null;

    if (authErrorCode === 'unprovisioned') {
      return (
        <div className="mb-4">
          <Notice kind="warning">{t('login.error.unprovisioned', { email: authEmail || 'your Google account' })}</Notice>
        </div>
      );
    }
    if (authErrorCode === 'session_expired') {
      return (
        <div className="mb-4">
          <Notice kind="warning">{t('login.error.sessionExpired')}</Notice>
        </div>
      );
    }
    if (authErrorCode === 'state_mismatch') {
      return (
        <div className="mb-4">
          <Notice kind="warning">{t('login.error.stateMismatch')}</Notice>
        </div>
      );
    }
    if (authErrorCode === 'cancelled') {
      return (
        <div className="mb-4">
          <Notice kind="info">{t('login.error.cancelled')}</Notice>
        </div>
      );
    }
    return (
      <div className="mb-4">
        <Notice kind="warning">{t('login.error.generic')}</Notice>
      </div>
    );
  }

  const tabs = [
    { id: 'pin', label: t('login.tabs.phone'), icon: KeyRound },
    { id: 'otp', label: t('login.tabs.otp'), icon: MessageSquareText },
    { id: 'social', label: t('login.tabs.social'), icon: Users },
  ] as const;

  function selectTab(id: (typeof tabs)[number]['id'], focus = false) {
    setActiveTab(id);
    if (focus) document.getElementById(`login-tab-${id}`)?.focus();
  }

  return (
    <div className="login-page">
      {demo.data ? <DemoBanner /> : null}
      <header className="login-bar">
        <span className="wordmark">
          <BrandMark />
          <span className="wordmark-text">FairShift</span>
        </span>
        <div className="login-bar-tools">
          <button type="button" className="btn btn-quiet btn-sm login-qr" onClick={() => setShowQr(true)} aria-haspopup="dialog">
            <QrCode className="icon-sm" aria-hidden="true" />
            <span>{t('login.openOnPhone')}</span>
          </button>
          <LanguagePicker />
        </div>
      </header>

      <main id="main" className="login">
        <section className="login-story" aria-labelledby="login-heading">
          <h1 id="login-heading">{t('login.heading')}</h1>
          <p className="login-lead">{t('login.lead')}</p>
        </section>

        <div className="login-side">
          <section className="login-panel" aria-labelledby="login-title">
            <h2 id="login-title" className="login-title">
              {t('login.title')}
            </h2>
            {renderAuthErrorBanner()}

            <div className="segmented" role="tablist" aria-label={t('login.methods')}>
              {tabs.map((tab, i) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`login-tab-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  aria-controls={activeTab === tab.id ? 'login-method' : undefined}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  className="segmented-option"
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={(e) => {
                    const last = tabs.length - 1;
                    const to =
                      e.key === 'ArrowRight'
                        ? i === last
                          ? 0
                          : i + 1
                        : e.key === 'ArrowLeft'
                          ? i === 0
                            ? last
                            : i - 1
                          : e.key === 'Home'
                            ? 0
                            : e.key === 'End'
                              ? last
                              : -1;
                    if (to < 0) return;
                    e.preventDefault();
                    selectTab(tabs[to]!.id, true);
                  }}
                >
                  <tab.icon className="icon-sm" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            <div role="tabpanel" id="login-method" aria-labelledby={`login-tab-${activeTab}`} className="login-method">
              {activeTab === 'pin' && (
                <form onSubmit={submitPin} noValidate>
                  {error && !Object.keys(f).length ? <ErrorBox error={error} /> : null}
                  <Field label={t('login.phone')} hint={t('login.phoneHint')} error={f['phone']}>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="username"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.trim())}
                      maxLength={10}
                    />
                  </Field>
                  <Field label={t('login.pin')} hint={t('login.pinHint')} error={f['pin']}>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="current-password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.trim())}
                      maxLength={6}
                    />
                  </Field>
                  <Button type="submit" busy={busy} className="btn btn-primary btn-big">
                    {t('action.signIn')}
                  </Button>
                </form>
              )}

              {activeTab === 'otp' && (
                <>
                  {otpError && !Object.keys(otpFields).length ? <ErrorBox error={otpError} /> : null}
                  {!otpSent ? (
                    <form onSubmit={handleSendOtp} noValidate>
                      <Field label={t('login.phone')} hint={t('login.phoneHint')} error={otpFields['phone']}>
                        <input
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel-national"
                          value={otpPhone}
                          onChange={(e) => setOtpPhone(e.target.value.trim())}
                          maxLength={10}
                        />
                      </Field>
                      {authConfig.data && !authConfig.data.providers.phoneOtp.configured ? (
                        <p className="login-unavailable">{t('login.otp.notConfigured')}</p>
                      ) : null}
                      <Button
                        type="submit"
                        busy={otpBusy}
                        disabled={!otpPhone || Boolean(authConfig.data && !authConfig.data.providers.phoneOtp.configured)}
                        className="btn btn-primary btn-big"
                      >
                        {t('login.otp.requestCode')}
                      </Button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyOtp} noValidate>
                      <Notice kind="info">{t('login.otp.sent', { phone: otpPhone })}</Notice>
                      <Field label={t('login.otp.code')} hint={t('login.otp.codeHint')} error={otpFields['code']}>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value.trim())}
                          maxLength={6}
                        />
                      </Field>
                      <div className="form-actions">
                        <Button type="submit" busy={otpBusy} className="btn btn-primary btn-big">
                          {t('login.otp.verifyCode')}
                        </Button>
                        <Button type="button" variant="secondary" disabled={otpCooldown > 0 || otpBusy} onClick={handleSendOtp}>
                          {otpCooldown > 0 ? `${t('login.otp.resend')} (${otpCooldown}s)` : t('login.otp.resend')}
                        </Button>
                      </div>
                    </form>
                  )}
                </>
              )}

              {activeTab === 'social' && (
                <div className="login-sso">
                  {authConfig.data?.providers.google.configured ? (
                    <a href="/api/auth/google/start" className="btn-oauth">
                      <GoogleIcon />
                      <span>{t('login.google')}</span>
                    </a>
                  ) : (
                    <div>
                      <button type="button" disabled className="btn-oauth">
                        <GoogleIcon />
                        <span>{t('login.google')}</span>
                      </button>
                      <p className="login-unavailable">{t('login.googleNotConfigured')}</p>
                    </div>
                  )}
                  {authConfig.data?.providers.github.configured ? (
                    <a href="/api/auth/github/start" className="btn-oauth">
                      <GithubIcon />
                      <span>{t('login.github')}</span>
                    </a>
                  ) : (
                    <div>
                      <button type="button" disabled className="btn-oauth">
                        <GithubIcon />
                        <span>{t('login.github')}</span>
                      </button>
                      <p className="login-unavailable">{t('login.githubNotConfigured')}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {demo.data ? (
            <section className="login-demo" aria-labelledby="login-demo-title">
              <h2 id="login-demo-title">{t('login.demoTitle')}</h2>
              <p>
                {t('login.demoHint')} {demo.data.pinHint}
              </p>
              <ul className="demo-accounts">
                {demo.data.accounts.map((a) => (
                  <li key={a.phone}>
                    <button
                      type="button"
                      className="demo-account"
                      aria-pressed={activeTab === 'pin' && phone === a.phone}
                      onClick={() => {
                        setActiveTab('pin');
                        setPhone(a.phone);
                        setPin('');
                        setTimeout(() => {
                          document.querySelector<HTMLInputElement>('#login-method input[type=password]')?.focus();
                        }, 50);
                      }}
                    >
                      <span className="visually-hidden">{t('login.use')} </span>
                      <span className="demo-account-name">{a.name}</span>
                      <span className="demo-account-role">
                        {a.role === 'admin' ? t('role.admin') : a.jobTitle}, {getIndustry(a.industry).label.split(' (')[0]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="login-note">{t('login.methodsNote')}</p>
        </div>

        <div className="login-about">
          <ul className="login-points">
            {(
              [
                [Clock, 'login.point1'],
                [ShieldAlert, 'login.point2'],
                [MessageSquare, 'login.point3'],
                [Languages, 'login.languages'],
              ] as const
            ).map(([Icon, key]) => (
              <li key={key}>
                <Icon className="icon" aria-hidden="true" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="login-sdg">{t('login.sdg')}</p>
        </div>
      </main>
      <MobileDemoQrModal isOpen={showQr} onClose={() => setShowQr(false)} />
      <OverlayLayer />
    </div>
  );
}
