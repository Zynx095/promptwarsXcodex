import type { ReactNode } from 'react';
import {
  Award,
  BarChart3,
  CalendarCheck,
  ClipboardList,
  Clock,
  FileText,
  Home,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  ShieldAlert,
  SlidersHorizontal,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link, useRouter } from '../lib/router';
import { LANGUAGES, useI18n, type Lang, type MessageKey } from '../lib/i18n';
import { useSession } from '../lib/session';
import { getIndustry } from '../../shared/industries';

const WORKER_NAV: { to: string; key: MessageKey; short: MessageKey; icon: LucideIcon }[] = [
  { to: '/worker', key: 'nav.home', short: 'navShort.home', icon: Home },
  { to: '/worker/attendance', key: 'nav.attendance', short: 'navShort.attendance', icon: Clock },
  { to: '/worker/payslips', key: 'nav.payslips', short: 'navShort.payslips', icon: Wallet },
  { to: '/worker/reports', key: 'nav.reports', short: 'navShort.reports', icon: ShieldAlert },
  { to: '/worker/feedback', key: 'nav.feedback', short: 'navShort.feedback', icon: MessageSquare },
  { to: '/worker/skills', key: 'nav.skills', short: 'navShort.skills', icon: Award },
];

const ADMIN_NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/workers', label: 'Workforce', icon: Users },
  { to: '/admin/shifts', label: 'Shifts', icon: CalendarCheck },
  { to: '/admin/reports', label: 'Safety reports', icon: ShieldAlert },
  { to: '/admin/alerts', label: 'Hours alerts', icon: BarChart3 },
  { to: '/admin/payslips', label: 'Payslips', icon: Wallet },
  { to: '/admin/pay-rules', label: 'Pay & hours rules', icon: SlidersHorizontal },
  { to: '/admin/feedback', label: 'Feedback', icon: MessageSquare },
  { to: '/admin/audit', label: 'Audit log', icon: ClipboardList },
];

export function LanguageSelect() {
  const { lang, setLang, t } = useI18n();
  return (
    <label className="lang-select">
      <span className="visually-hidden">{t('common.language')}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('common.language')}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DemoBanner() {
  const { t } = useI18n();
  return (
    <p className="demo-banner" role="note">
      {t('demo.banner')}
    </p>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      F
    </span>
  );
}

function SignOut() {
  const { logout } = useSession();
  const { t } = useI18n();
  const { navigate } = useRouter();
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={async () => {
        await logout();
        navigate('/', { replace: true });
      }}
    >
      <LogOut className="icon" aria-hidden="true" />
      <span className="label-sm-hidden">{t('action.signOut')}</span>
    </button>
  );
}

/** Worker shell: compact header, top tabs on wide screens and a bottom bar on phones. */
function WorkerShell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { t } = useI18n();
  if (!me) return null;
  return (
    <div className="area-worker">
      <a className="skip-link" href="#main">
        {t('nav.skip')}
      </a>
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            FairShift <span className="role-pill">{t('role.worker')}</span>
            <small>
              {me.org.name} · {getIndustry(me.org.industry).label}
            </small>
          </div>
        </div>
        <div className="topbar-tools">
          <LanguageSelect />
          <SignOut />
        </div>
      </header>
      {me.org.synthetic || me.demoMode ? <DemoBanner /> : null}
      <nav className="mainnav" aria-label={t('nav.main')}>
        <ul>
          {WORKER_NAV.map(({ to, key, short, icon: Icon }) => (
            <li key={to}>
              <Link to={to}>
                <Icon className="icon" aria-hidden="true" />
                <span className="nav-full">{t(key)}</span>
                <span className="nav-short" aria-hidden="true">
                  {t(short)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

/** Employer shell: navy sidebar on desktop, horizontal tabs on smaller screens. */
function AdminShell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { t } = useI18n();
  if (!me) return null;
  const industry = getIndustry(me.org.industry);
  const links = (
    <ul>
      {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
        <li key={to}>
          <Link to={to}>
            <Icon className="icon" aria-hidden="true" />
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="area-admin admin-shell">
      <a className="skip-link" href="#main">
        {t('nav.skip')}
      </a>
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            FairShift
            <small>Employer console</small>
          </div>
        </div>
        <div className="sidebar-org">
          <strong>{me.org.name}</strong>
          <span>{industry.label}</span>
        </div>
        <nav className="sidenav" aria-label="Employer navigation">
          {links}
        </nav>
        <p className="sidebar-foot">
          <FileText className="icon" aria-hidden="true" data-size="sm" /> Rules and records are scoped to your organisation.
        </p>
      </aside>
      <div className="admin-body">
        <header className="topbar">
          <div className="brand">
            <span className="hide-desktop-brand">
              <BrandMark />
            </span>
            <div className="brand-text">
              {me.org.name} <span className="role-pill">{t('role.admin')}</span>
              <small>{industry.label}</small>
            </div>
          </div>
          <div className="topbar-tools">
            <div className="topbar-user hide-sm">
              <strong>{me.user.name}</strong>
              <span>{me.user.jobTitle}</span>
            </div>
            <LanguageSelect />
            <SignOut />
          </div>
        </header>
        {me.org.synthetic || me.demoMode ? <DemoBanner /> : null}
        <nav className="mainnav" aria-label="Employer navigation (compact)">
          {links}
        </nav>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { me } = useSession();
  if (!me) return <>{children}</>;
  return me.user.role === 'admin' ? <AdminShell>{children}</AdminShell> : <WorkerShell>{children}</WorkerShell>;
}
