// Worker home: answers, in order, "what is my status?", "what have I earned this week?",
// "what is recorded?", "does anything need me?" and "where are my records?".
import type { ReactNode } from 'react';
import { BellRing, ChevronRight, CircleCheck, Clock, IndianRupee, Scale, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useI18n, useMoney } from '../../lib/i18n';
import { useMe } from '../../lib/session';
import { useApi, type ApiState } from '../../lib/useApi';
import { Link, useRouter } from '../../lib/router';
import { useNotifications } from '../../lib/notifications';
import { formatDateTime, formatMinutes, formatPeriod } from '../../lib/format';
import type { AlertDTO, Paged, PayCheckDTO, PayslipDTO, PayslipListItem, SafetyReportDTO } from '../../../shared/types';
import { qs } from '../../lib/api';
import { SHORTFALL_STATUS } from '../../components/PayCheck';
import { ErrorBox, Skeleton } from '../../components/ui';
import { ShiftCard } from '../../components/ShiftCard';
import { WeekStrip } from '../../components/WeekStrip';

const RESOLVED = new Set(['resolved', 'outcome_verified']);

function SectionSkeleton() {
  return (
    <div className="home-skeleton" aria-hidden="true">
      <Skeleton height={20} width="40%" />
      <Skeleton height={20} width="70%" />
    </div>
  );
}

function Pending<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (state.data === null) return <SectionSkeleton />;
  return <>{children(state.data)}</>;
}

function WeekSection({ preview }: { preview: ApiState<PayslipDTO> }) {
  const { t } = useI18n();
  const money = useMoney();
  return (
    <section className="home-section" aria-labelledby="home-week">
      <div className="section-head">
        <h2 id="home-week">{t('home.weekTitle')}</h2>
        <span className="badge badge-warn">{t('pay.estimate')}</span>
      </div>
      <Pending state={preview}>
        {(p) => {
          const b = p.breakdown;
          return (
            <div className="week-record">
              <p className="week-amount">
                <span className="figure">{money(b.netPayMinor, p.currency)}</span>
                <span className="week-amount-label">{t('pay.net')}</span>
              </p>
              <p className="week-hours">
                {t('home.weekHours', { worked: formatMinutes(b.regularMinutes + b.overtimeMinutes), overtime: formatMinutes(b.overtimeMinutes) })}
              </p>
              <WeekStrip from={p.periodStart} to={p.periodEnd} days={b.days} scheduledMinutes={b.scheduledDailyMinutes} today={p.periodEnd} />
              <p className="week-note">{t('pay.currentHint')}</p>
              <Link to="/worker/payslips" className="row-link">
                <span>{t('home.seePay')}</span>
                <ChevronRight className="icon" aria-hidden="true" />
              </Link>
            </div>
          );
        }}
      </Pending>
    </section>
  );
}

function AttentionSection({ alerts }: { alerts: ApiState<{ items: AlertDTO[] }> }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const { navigate } = useRouter();
  const notifications = useNotifications();
  // At most three items: long-hours alerts first, then the newest unread updates.
  const openAlerts = (alerts.data?.items ?? []).filter((a) => a.status === 'open').slice(0, 2);
  const unread = notifications.items.filter((n) => !n.read).slice(0, 3 - openAlerts.length);
  const loading = alerts.data === null || !notifications.loaded;

  return (
    <section className="home-section" aria-labelledby="home-attention">
      <div className="section-head">
        <h2 id="home-attention">{t('home.attention')}</h2>
      </div>
      {loading && !alerts.error ? (
        <SectionSkeleton />
      ) : openAlerts.length === 0 && unread.length === 0 ? (
        <p className="home-clear">
          <CircleCheck className="icon" aria-hidden="true" />
          {t('home.nothingNeeded')}
        </p>
      ) : (
        <ul className="row-list">
          {openAlerts.map((a) => (
            <li key={a.id}>
              <div className="row-item row-static">
                <span className="row-icon tone-caution" aria-hidden="true">
                  <TriangleAlert className="icon" />
                </span>
                <span className="row-text">
                  <strong>{t(`rule.${a.rule}`)}</strong>
                  <span>{a.details}</span>
                  <span className="row-meta">{formatDateTime(a.createdAt, me.org.timezone, locale)}</span>
                </span>
              </div>
            </li>
          ))}
          {unread.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="row-item"
                onClick={async () => {
                  await notifications.markRead(n.id).catch(() => undefined);
                  if (n.link) navigate(n.link);
                }}
              >
                <span className={`row-icon ${n.type === 'safety_alert' ? 'tone-danger' : 'tone-info'}`} aria-hidden="true">
                  <BellRing className="icon" />
                </span>
                <span className="row-text">
                  <strong>{n.title}</strong>
                  <span>{n.body}</span>
                  <span className="row-meta">{formatDateTime(n.createdAt, me.org.timezone, locale)}</span>
                </span>
                {n.link ? <ChevronRight className="icon chevron" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {openAlerts.length > 0 ? <p className="home-footnote">{t('home.alertsHint')}</p> : null}
    </section>
  );
}

function RecordsSection({
  preview,
  latest,
  reports,
  payCheck,
}: {
  preview: ApiState<PayslipDTO>;
  latest: ApiState<Paged<PayslipListItem>>;
  reports: ApiState<{ items: SafetyReportDTO[] }>;
  payCheck: ApiState<PayCheckDTO>;
}) {
  const { t, locale } = useI18n();
  const money = useMoney();
  const shiftsThisWeek = preview.data?.breakdown.days.reduce((n, d) => n + d.shiftCount, 0);
  const last = latest.data?.items[0];
  const openReports = reports.data?.items.filter((r) => !RESOLVED.has(r.status)).length;

  return (
    <section className="home-section" aria-labelledby="home-records">
      <div className="section-head">
        <h2 id="home-records">{t('home.records')}</h2>
      </div>
      <ul className="row-list">
        <li>
          <Link to="/worker/attendance" className="row-item">
            <span className="row-icon" aria-hidden="true">
              <Clock className="icon" />
            </span>
            <span className="row-text">
              <strong>{t('home.shiftsRow')}</strong>
              {shiftsThisWeek !== undefined ? <span>{t('home.shiftsMeta', { count: shiftsThisWeek })}</span> : null}
            </span>
            <ChevronRight className="icon chevron" aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link to="/worker/payslips" className="row-item">
            <span className="row-icon" aria-hidden="true">
              <IndianRupee className="icon" />
            </span>
            <span className="row-text">
              <strong>{t('nav.payslips')}</strong>
              {latest.data ? (
                <span>
                  {last
                    ? t('home.latestPayslip', {
                        period: formatPeriod(last.periodStart, last.periodEnd, locale),
                        amount: money(last.netPayMinor),
                      })
                    : t('pay.none')}
                </span>
              ) : null}
            </span>
            <ChevronRight className="icon chevron" aria-hidden="true" />
          </Link>
        </li>
        {payCheck.data ? (
          <li>
            <Link to="/worker/payslips" className="row-item">
              <span
                className={`row-icon tone-${SHORTFALL_STATUS[payCheck.data.result.status].tone === 'good' ? 'good' : SHORTFALL_STATUS[payCheck.data.result.status].tone === 'neutral' ? 'info' : 'caution'}`}
                aria-hidden="true"
              >
                <Scale className="icon" />
              </span>
              <span className="row-text">
                <strong>{t('paycheck.title')}</strong>
                <span>
                  {t(SHORTFALL_STATUS[payCheck.data.result.status].key)}, {formatPeriod(payCheck.data.period.from, payCheck.data.period.to, locale)}
                </span>
              </span>
              <ChevronRight className="icon chevron" aria-hidden="true" />
            </Link>
          </li>
        ) : null}
        <li>
          <Link to="/worker/reports" className="row-item">
            <span className="row-icon" aria-hidden="true">
              <ShieldAlert className="icon" />
            </span>
            <span className="row-text">
              <strong>{t('nav.reports')}</strong>
              {openReports !== undefined ? <span>{t('home.openReports', { count: openReports })}</span> : null}
            </span>
            <ChevronRight className="icon chevron" aria-hidden="true" />
          </Link>
        </li>
      </ul>
      <Link to="/worker/reports/new" className="btn btn-secondary home-report">
        <ShieldAlert className="icon" aria-hidden="true" />
        {t('home.reportHazard')}
      </Link>
    </section>
  );
}

export function WorkerHome() {
  const { t } = useI18n();
  const me = useMe();
  const preview = useApi<PayslipDTO>('/payslips/preview');
  const alerts = useApi<{ items: AlertDTO[] }>('/alerts/mine');
  const latest = useApi<Paged<PayslipListItem>>('/payslips?limit=1');
  const reports = useApi<{ items: SafetyReportDTO[] }>('/reports/mine');
  // Payment status for the most recent issued pay period
  const lastSlip = latest.data?.items[0];
  const payCheck = useApi<PayCheckDTO>(lastSlip ? `/pay-check${qs({ from: lastSlip.periodStart, to: lastSlip.periodEnd })}` : null);
  const role = [me.user.jobTitle, me.user.team].filter(Boolean).join(', ');

  return (
    <div className="home">
      <header className="home-greeting">
        <h1>{t('home.hello', { name: me.user.name })}</h1>
        {role ? <p>{role}</p> : null}
      </header>
      <ShiftCard
        onChange={() => {
          preview.reload();
          alerts.reload();
        }}
      />
      <WeekSection preview={preview} />
      <AttentionSection alerts={alerts} />
      <RecordsSection preview={preview} latest={latest} reports={reports} payCheck={payCheck} />
    </div>
  );
}
