import { useState, type ReactNode } from 'react';
import {
  Award,
  BarChart3,
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  Clock,
  Ellipsis,
  Home,
  IndianRupee,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  ShieldAlert,
  Camera,
  KeyRound,
  Scale,
  SlidersHorizontal,
  UserRoundSearch,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link, useRouter } from '../lib/router';
import { useI18n, type MessageKey } from '../lib/i18n';
import { useSession } from '../lib/session';
import { NotificationsProvider } from '../lib/notifications';
import { getIndustry } from '../../shared/industries';
import { NotificationBell } from './NotificationBell';
import { OverlayLayer, Sheet } from './Sheet';
import { LanguagePicker } from './LanguagePicker';
import { ThemePicker } from './ThemePicker';
import { OfflineBanner } from './OfflineStatus';
import { AppUpdateBanner } from './AppUpdateBanner';
import { ConfirmDialog } from './ui';
import { OutboxProvider } from '../lib/outboxContext';
import { isUnsent, loadOutbox } from '../lib/outbox';

interface WorkerDestination {
  to: string;
  key: MessageKey;
  short: MessageKey;
  icon: LucideIcon;
  exact?: boolean;
}

/** The four destinations a worker uses daily live in the bottom bar; the rest are under More. */
const WORKER_PRIMARY: WorkerDestination[] = [
  { to: '/worker', key: 'nav.home', short: 'navShort.home', icon: Home, exact: true },
  { to: '/worker/attendance', key: 'nav.attendance', short: 'navShort.attendance', icon: Clock },
  { to: '/worker/payslips', key: 'nav.payslips', short: 'navShort.payslips', icon: IndianRupee },
  { to: '/worker/reports', key: 'nav.reports', short: 'navShort.reports', icon: ShieldAlert },
];
const WORKER_SECONDARY: WorkerDestination[] = [
  { to: '/worker/feedback', key: 'nav.feedback', short: 'navShort.feedback', icon: MessageSquare },
  { to: '/worker/skills', key: 'nav.skills', short: 'navShort.skills', icon: Award },
  { to: '/worker/security', key: 'nav.security', short: 'nav.security', icon: KeyRound },
];

function isActive(path: string, d: WorkerDestination): boolean {
  return d.exact ? path === d.to : path === d.to || path.startsWith(d.to + '/');
}

const ADMIN_NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/workers', label: 'Workforce', icon: Users },
  { to: '/admin/retention', label: 'Retention attention', icon: UserRoundSearch },
  { to: '/admin/sites', label: 'Sites & QR check-in', icon: MapPin },
  { to: '/admin/shifts', label: 'Shifts', icon: CalendarCheck },
  { to: '/admin/reports', label: 'Safety reports', icon: ShieldAlert },
  { to: '/admin/inspections', label: 'Photo inspections', icon: Camera },
  { to: '/admin/alerts', label: 'Hours alerts', icon: BarChart3 },
  { to: '/admin/payslips', label: 'Payslips', icon: Wallet },
  { to: '/admin/pay-check', label: 'Pay check', icon: Scale },
  { to: '/admin/pay-rules', label: 'Pay & hours rules', icon: SlidersHorizontal },
  { to: '/admin/feedback', label: 'Feedback', icon: MessageSquare },
  { to: '/admin/audit', label: 'Audit log', icon: ClipboardList },
];

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
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="#3a0f34" />
      <path d="M10 7h13v4.5h-8v3.2h6.5v4.3H15V25h-5z" fill="#eaaa00" />
    </svg>
  );
}

function Wordmark() {
  return (
    <span className="wordmark">
      <BrandMark />
      <span className="wordmark-text">FairShift</span>
    </span>
  );
}

function SignOut({ className = 'btn btn-secondary', onDone, compact = true }: { className?: string; onDone?: () => void; compact?: boolean }) {
  const { logout, me } = useSession();
  const { t } = useI18n();
  const { navigate } = useRouter();
  const [confirm, setConfirm] = useState<number | null>(null);
  const finish = async () => {
    setConfirm(null);
    onDone?.();
    await logout();
    navigate('/', { replace: true });
  };
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          // Unsent check-ins or reports are deleted from the phone at sign-out, so ask first
          const unsent = me && me.user.role === 'worker' ? loadOutbox(me.user.id).filter(isUnsent).length : 0;
          if (unsent > 0) setConfirm(unsent);
          else void finish();
        }}
      >
        <LogOut className="icon" aria-hidden="true" />
        <span className={compact ? 'label-sm-hidden' : undefined}>{t('action.signOut')}</span>
      </button>
      <ConfirmDialog
        isOpen={confirm !== null}
        title={t('off.signOutTitle')}
        message={t('off.signOutBody', { count: confirm ?? 0 })}
        confirmLabel={t('off.signOutConfirm')}
        cancelLabel={t('action.cancel')}
        variant="danger"
        onConfirm={() => void finish()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

/**
 * Worker shell. Phones get a top bar and a bottom bar with the four daily destinations plus a
 * More sheet; wide screens get a light rail with every destination. Both navigations are in the
 * document, and CSS shows exactly one of them for the current width.
 */
function WorkerShell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { t } = useI18n();
  const { path } = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  if (!me) return null;
  const demo = me.org.synthetic || me.demoMode;
  const moreActive = WORKER_SECONDARY.some((d) => isActive(path, d));
  const role = [me.user.jobTitle, me.user.team].filter(Boolean).join(', ');

  return (
    <div className="worker-shell">
      <a className="skip-link" href="#main">
        {t('nav.skip')}
      </a>

      <aside className="ws-rail">
        <Wordmark />
        <p className="ws-rail-org">
          {me.org.name}
          <span>{getIndustry(me.org.industry).label}</span>
        </p>
        <nav className="ws-rail-nav" aria-label={t('nav.main')}>
          <ul>
            {[...WORKER_PRIMARY, ...WORKER_SECONDARY].map((d) => (
              <li key={d.to}>
                <Link to={d.to} aria-current={isActive(path, d) ? 'page' : undefined}>
                  <d.icon className="icon" aria-hidden="true" />
                  <span>{t(d.key)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ws-rail-foot">
          <p className="ws-rail-user">
            <strong>{me.user.name}</strong>
            {role ? <span>{role}</span> : null}
          </p>
          <SignOut className="btn btn-secondary btn-sm ws-signout" compact={false} />
        </div>
      </aside>

      <div className="ws-body">
        <header className="ws-topbar">
          <span className="ws-topbar-brand">
            <Wordmark />
          </span>
          <span className="ws-topbar-org">{me.org.name}</span>
          {demo ? (
            <span className="demo-chip">
              <span aria-hidden="true">{t('demo.chip')}</span>
              <span className="visually-hidden">{t('demo.banner')}</span>
            </span>
          ) : null}
          <div className="ws-topbar-tools">
            <LanguagePicker />
            <ThemePicker />
            <NotificationBell />
          </div>
        </header>

        <main id="main" tabIndex={-1}>
          <AppUpdateBanner />
          <OfflineBanner />
          {children}
        </main>
      </div>

      <nav className="ws-tabbar" aria-label={t('nav.main')}>
        <ul>
          {WORKER_PRIMARY.map((d) => (
            <li key={d.to}>
              <Link to={d.to} aria-current={isActive(path, d) ? 'page' : undefined}>
                <d.icon className="icon" aria-hidden="true" />
                <span>{t(d.short)}</span>
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-current={moreActive ? 'page' : undefined}
              onClick={() => setMoreOpen(true)}
            >
              <Ellipsis className="icon" aria-hidden="true" />
              <span>{t('navShort.more')}</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t('navShort.more')}>
        <ul className="sheet-links">
          {WORKER_SECONDARY.map((d) => (
            <li key={d.to}>
              <Link to={d.to} onClick={() => setMoreOpen(false)} aria-current={isActive(path, d) ? 'page' : undefined}>
                <d.icon className="icon" aria-hidden="true" />
                <span>{t(d.key)}</span>
                <ChevronRight className="icon chevron" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        <div className="sheet-account">
          <p className="m-0">
            <strong>{me.user.name}</strong>
          </p>
          {role ? <p className="muted small m-0">{role}</p> : null}
          <p className="muted small">
            {me.org.name}, {getIndustry(me.org.industry).label}
          </p>
          {demo ? <p className="demo-note">{t('demo.banner')}</p> : null}
          <SignOut className="btn btn-secondary sheet-signout" compact={false} onDone={() => setMoreOpen(false)} />
        </div>
      </Sheet>
      <OverlayLayer />
    </div>
  );
}

function isAdminActive(path: string, to: string): boolean {
  return to === '/admin' ? path === '/admin' : path === to || path.startsWith(to + '/');
}

/**
 * Employer console. From 1024 px an aubergine sidebar holds the navigation and the account;
 * below that a top bar opens the same navigation in a sheet.
 */
function AdminShell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const { t } = useI18n();
  const { path } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!me) return null;
  const industry = getIndustry(me.org.industry);
  const demo = me.org.synthetic || me.demoMode;
  const role = [me.user.jobTitle, t('role.admin')].filter(Boolean).join(', ');

  return (
    <div className="admin-shell">
      <a className="skip-link" href="#main">
        {t('nav.skip')}
      </a>

      <aside className="as-sidebar on-dark">
        <Wordmark />
        <p className="as-org">
          {me.org.name}
          <span>{industry.label}</span>
        </p>
        <nav className="as-nav" aria-label="Employer navigation">
          <ul>
            {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link to={to} aria-current={isAdminActive(path, to) ? 'page' : undefined}>
                  <Icon className="icon" aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="as-foot">
          <p className="as-user">
            <strong>{me.user.name}</strong>
            <span>{role}</span>
          </p>
          <SignOut className="btn btn-sm as-signout" compact={false} />
        </div>
      </aside>

      <div className="as-body">
        <header className="as-topbar">
          <button type="button" className="as-menu" aria-haspopup="dialog" aria-expanded={menuOpen} aria-label="Open menu" onClick={() => setMenuOpen(true)}>
            <Menu className="icon" aria-hidden="true" />
          </button>
          <span className="as-topbar-brand">
            <Wordmark />
          </span>
          <span className="as-topbar-org">
            {me.org.name}
            <span>Employer console</span>
          </span>
          {demo ? (
            <span className="demo-chip">
              <span aria-hidden="true">{t('demo.chip')}</span>
              <span className="visually-hidden">{t('demo.banner')}</span>
            </span>
          ) : null}
          <div className="as-topbar-tools">
            <LanguagePicker />
            <ThemePicker />
            <NotificationBell />
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <AppUpdateBanner />
          {children}
        </main>
      </div>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Employer console">
        <ul className="sheet-links">
          {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link to={to} onClick={() => setMenuOpen(false)} aria-current={isAdminActive(path, to) ? 'page' : undefined}>
                <Icon className="icon" aria-hidden="true" />
                <span>{label}</span>
                <ChevronRight className="icon chevron" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        <div className="sheet-account">
          <p className="m-0">
            <strong>{me.user.name}</strong>
          </p>
          <p className="muted small m-0">{role}</p>
          <p className="muted small">
            {me.org.name}, {industry.label}
          </p>
          {demo ? <p className="demo-note">{t('demo.banner')}</p> : null}
          <SignOut className="btn btn-secondary sheet-signout" compact={false} onDone={() => setMenuOpen(false)} />
        </div>
      </Sheet>
      <OverlayLayer />
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { me } = useSession();
  if (!me) return <>{children}</>;
  return (
    <NotificationsProvider>
      {me.user.role === 'admin' ? (
        <AdminShell>{children}</AdminShell>
      ) : (
        <OutboxProvider userId={me.user.id}>
          <WorkerShell>{children}</WorkerShell>
        </OutboxProvider>
      )}
    </NotificationsProvider>
  );
}
