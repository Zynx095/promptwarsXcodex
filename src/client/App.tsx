// Route table and role-aware routing. Guards here are for navigation only; the API enforces access.
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, matchPath, useRouter } from './lib/router';
import { useSession } from './lib/session';
import { useI18n } from './lib/i18n';
import type { Role } from '../shared/types';
import { Layout } from './components/Layout';
import { ErrorBox, Loading, Page } from './components/ui';
import { LoginPage } from './pages/Login';
import { WorkerHome } from './pages/worker/Home';
import { WorkerAttendance } from './pages/worker/Attendance';
import { WorkerPayslips, WorkerPayslipView } from './pages/worker/Payslips';
import { WorkerReportNew, WorkerReports, WorkerReportView } from './pages/worker/Reports';
import { WorkerFeedback } from './pages/worker/Feedback';
import { WorkerSkills } from './pages/worker/Skills';
import { WorkerSecurity } from './pages/worker/Security';
import { WorkerQrCheckIn } from './pages/worker/QrCheckIn';
import { ThemeProvider } from './lib/theme';

// The employer console is loaded only when an administrator opens it, so workers' phones never
// download it.
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard').then((m) => ({ default: m.AdminDashboard })));
const AdminWorkers = lazy(() => import('./pages/admin/Workers').then((m) => ({ default: m.AdminWorkers })));
const AdminWorkerSkills = lazy(() => import('./pages/admin/Workers').then((m) => ({ default: m.AdminWorkerSkills })));
const AdminSites = lazy(() => import('./pages/admin/Sites').then((m) => ({ default: m.AdminSites })));
const AdminShifts = lazy(() => import('./pages/admin/Shifts').then((m) => ({ default: m.AdminShifts })));
const AdminReports = lazy(() => import('./pages/admin/Reports').then((m) => ({ default: m.AdminReports })));
const AdminReportView = lazy(() => import('./pages/admin/Reports').then((m) => ({ default: m.AdminReportView })));
const AdminInspections = lazy(() => import('./pages/admin/Inspections').then((m) => ({ default: m.AdminInspections })));
const AdminAlerts = lazy(() => import('./pages/admin/Alerts').then((m) => ({ default: m.AdminAlerts })));
const AdminPayslips = lazy(() => import('./pages/admin/Payslips').then((m) => ({ default: m.AdminPayslips })));
const AdminPayslipView = lazy(() => import('./pages/admin/Payslips').then((m) => ({ default: m.AdminPayslipView })));
const AdminPayRules = lazy(() => import('./pages/admin/PayRules').then((m) => ({ default: m.AdminPayRules })));
const AdminFeedback = lazy(() => import('./pages/admin/Feedback').then((m) => ({ default: m.AdminFeedback })));
const AdminAudit = lazy(() => import('./pages/admin/Audit').then((m) => ({ default: m.AdminAudit })));
const AdminRetention = lazy(() => import('./pages/admin/Retention').then((m) => ({ default: m.AdminRetention })));
const AdminPayCheck = lazy(() => import('./pages/admin/PayCheck').then((m) => ({ default: m.AdminPayCheck })));

interface Route {
  path: string;
  role: Role;
  render: (params: Record<string, string>) => ReactNode;
}

const ROUTES: Route[] = [
  { path: '/worker', role: 'worker', render: () => <WorkerHome /> },
  { path: '/worker/attendance', role: 'worker', render: () => <WorkerAttendance /> },
  { path: '/worker/payslips', role: 'worker', render: () => <WorkerPayslips /> },
  { path: '/worker/payslips/:id', role: 'worker', render: (p) => <WorkerPayslipView id={p.id!} /> },
  { path: '/worker/reports', role: 'worker', render: () => <WorkerReports /> },
  { path: '/worker/reports/new', role: 'worker', render: () => <WorkerReportNew /> },
  { path: '/worker/reports/:id', role: 'worker', render: (p) => <WorkerReportView id={p.id!} /> },
  { path: '/worker/feedback', role: 'worker', render: () => <WorkerFeedback /> },
  { path: '/worker/skills', role: 'worker', render: () => <WorkerSkills /> },
  { path: '/worker/security', role: 'worker', render: () => <WorkerSecurity /> },
  // Opened by the phone's camera from a site QR code: /c/<token>
  { path: '/c/:token', role: 'worker', render: (p) => <WorkerQrCheckIn token={p.token!} /> },
  { path: '/admin', role: 'admin', render: () => <AdminDashboard /> },
  { path: '/admin/workers', role: 'admin', render: () => <AdminWorkers /> },
  { path: '/admin/workers/:id/skills', role: 'admin', render: (p) => <AdminWorkerSkills id={p.id!} /> },
  { path: '/admin/sites', role: 'admin', render: () => <AdminSites /> },
  { path: '/admin/shifts', role: 'admin', render: () => <AdminShifts /> },

  { path: '/admin/reports', role: 'admin', render: () => <AdminReports /> },
  { path: '/admin/inspections', role: 'admin', render: () => <AdminInspections /> },
  { path: '/admin/reports/:id', role: 'admin', render: (p) => <AdminReportView id={p.id!} /> },
  { path: '/admin/alerts', role: 'admin', render: () => <AdminAlerts /> },
  { path: '/admin/payslips', role: 'admin', render: () => <AdminPayslips /> },
  { path: '/admin/payslips/:id', role: 'admin', render: (p) => <AdminPayslipView id={p.id!} /> },
  { path: '/admin/pay-rules', role: 'admin', render: () => <AdminPayRules /> },
  { path: '/admin/feedback', role: 'admin', render: () => <AdminFeedback /> },
  { path: '/admin/audit', role: 'admin', render: () => <AdminAudit /> },
  { path: '/admin/retention', role: 'admin', render: () => <AdminRetention /> },
  { path: '/admin/pay-check', role: 'admin', render: () => <AdminPayCheck /> },
];

function resolve(path: string) {
  // Static segments win over parameters (e.g. /worker/reports/new before /worker/reports/:id).
  for (const r of ROUTES) if (!r.path.includes(':') && matchPath(r.path, path)) return { route: r, params: {} };
  for (const r of ROUTES) {
    const params = matchPath(r.path, path);
    if (params) return { route: r, params };
  }
  return null;
}

function Message({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <Page title={text}>
      <Link to="/">{t('err.goHome')}</Link>
    </Page>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <Routes />
    </ThemeProvider>
  );
}

function Routes() {
  const { me, loading, error, refresh } = useSession();
  const { path, navigate } = useRouter();
  const { t } = useI18n();
  const home = me ? (me.user.role === 'admin' ? '/admin' : '/worker') : null;

  useEffect(() => {
    if (home && (path === '/' || path === '/login')) navigate(home, { replace: true });
  }, [home, path, navigate]);

  useEffect(() => {
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [path]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={() => void refresh()} />;
  if (!me) return <LoginPage />;

  const match = resolve(path);
  let content: ReactNode;
  if (path === '/' || path === '/login') content = <Loading />;
  else if (!match) content = <Message text={t('err.notFound')} />;
  else if (match.route.role !== me.user.role) content = <Message text={t('err.notAllowed')} />;
  else content = match.route.render(match.params);

  return (
    <Layout>
      <Suspense fallback={<Loading />}>{content}</Suspense>
    </Layout>
  );
}
