import { useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronRight, ShieldAlert, Siren, type LucideIcon } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { qs } from '../../lib/api';
import { Link } from '../../lib/router';
import { useMe } from '../../lib/session';
import { formatDate, formatDateTime, formatMinutes } from '../../lib/format';
import type { AccountabilityMetricsDTO, DashboardDTO } from '../../../shared/types';
import { Async, BarChart, Button, Card, Empty, Field, Notice, Page } from '../../components/ui';

type Tone = 'default' | 'warn' | 'bad';

interface Action {
  to: string;
  icon: LucideIcon;
  tone: 'tone-danger' | 'tone-caution';
  label: string;
  note: string;
  count: number;
}

function minutesLabel(m: number | null | undefined): string {
  if (m == null) return '—';
  return m < 60 ? `${m}m` : `${Math.round((m / 60) * 10) / 10}h`;
}

function LedgerRow({ to, label, value, note, tone = 'default' }: { to: string; label: string; value: string | number; note?: string; tone?: Tone }) {
  return (
    <li>
      <Link to={to} className="ledger-row">
        <span className="ledger-label">{label}</span>
        <span className={`ledger-value${tone === 'default' ? '' : ` tone-${tone}`}`}>{value}</span>
        {note ? <span className="ledger-note">{note}</span> : null}
      </Link>
    </li>
  );
}

export function AdminDashboard() {
  const me = useMe();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [draft, setDraft] = useState({ from: '', to: '' });
  const dash = useApi<DashboardDTO>(`/admin/dashboard${qs(range)}`);
  const accountability = useApi<AccountabilityMetricsDTO>('/admin/reports/accountability');

  return (
    <Page title="Workforce dashboard" description="Every figure is calculated from recorded shifts, hazard reports and alerts for the selected dates.">
      <form
        className="range-bar"
        onSubmit={(e) => {
          e.preventDefault();
          setRange({ from: draft.from || undefined, to: draft.to || undefined });
        }}
        aria-label="Date range"
      >
        <Field label="From">
          <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </Field>
        <Field label="To">
          <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </Field>
        <Button type="submit" variant="secondary">
          Update
        </Button>
      </form>

      <Async state={dash}>
        {(d) => {
          const acc = accountability.data;
          const r = `from=${d.range.from}&to=${d.range.to}`;
          const trend = d.trend.map((p) => ({ label: p.date.slice(8), title: formatDate(p.date), value: p.present }));
          const overtime = d.trend.map((p) => ({ label: p.date.slice(8), title: formatDate(p.date), value: p.overtimeMinutes / 60 }));
          const actions: Action[] = [];
          if (d.criticalUnresolved > 0)
            actions.push({
              to: '/admin/reports?status=unresolved&severity=critical',
              icon: Siren,
              tone: 'tone-danger',
              label: 'Critical hazard reports not yet fixed',
              note: 'Record what is being done on each one.',
              count: d.criticalUnresolved,
            });
          if (d.openReports > 0)
            actions.push({
              to: '/admin/reports?status=unresolved',
              icon: ShieldAlert,
              tone: 'tone-caution',
              label: 'Hazard reports waiting for action',
              note: 'Acknowledge, assign and record the fix.',
              count: d.openReports,
            });
          if (acc && acc.overdueFollowUps > 0)
            actions.push({
              to: '/admin/reports?status=follow_up_pending',
              icon: CalendarClock,
              tone: 'tone-caution',
              label: 'Follow-up checks overdue',
              note: 'The date set to check a fix has passed.',
              count: acc.overdueFollowUps,
            });
          if (d.openAlerts > 0)
            actions.push({
              to: '/admin/alerts?status=open',
              icon: AlertTriangle,
              tone: 'tone-caution',
              label: 'Open hours alerts',
              note: 'Long days, short rests and missing check-outs.',
              count: d.openAlerts,
            });

          return (
            <>
              <p className="range-note">
                Showing {formatDate(d.range.from)} – {formatDate(d.range.to)}.
              </p>
              {d.synthetic ? (
                <Notice kind="warning">These figures come from synthetic demonstration records. They are not real organisational statistics.</Notice>
              ) : null}

              <section aria-labelledby="needs-action">
                <h2 id="needs-action" className="section-title">
                  Needs action
                </h2>
                {actions.length === 0 ? (
                  <p className="action-clear">Nothing needs action right now.</p>
                ) : (
                  <ul className="action-list">
                    {actions.map((a) => (
                      <li key={a.to}>
                        <Link to={a.to} className="action-row">
                          <span className={`row-icon ${a.tone}`} aria-hidden="true">
                            <a.icon className="icon" />
                          </span>
                          <span className="action-text">
                            <strong>{a.label}</strong>
                            <span>{a.note}</span>
                          </span>
                          <span className="action-count">{a.count}</span>
                          <ChevronRight className="icon chevron" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="ledgers">
                <section className="ledger" aria-labelledby="ledger-attendance">
                  <h2 id="ledger-attendance">Attendance</h2>
                  <ul>
                    <LedgerRow to="/admin/workers" label="Active workers" value={d.totalWorkers} />
                    <LedgerRow to="/admin/shifts?status=open" label="On shift now" value={d.onShiftNow} />
                    <LedgerRow to={`/admin/shifts?status=completed&${r}`} label="Completed shifts" value={d.completedShifts} />
                    <LedgerRow to={`/admin/shifts?${r}`} label="Hours worked" value={formatMinutes(d.workedMinutes)} />
                    <LedgerRow
                      to={`/admin/shifts?${r}`}
                      label="Overtime recorded"
                      value={formatMinutes(d.overtimeMinutes)}
                      note={`${d.workersWithOvertime} worker(s) with overtime`}
                      tone={d.overtimeMinutes ? 'warn' : 'default'}
                    />
                    <LedgerRow
                      to="/admin/alerts?status=open"
                      label="Open hours alerts"
                      value={d.openAlerts}
                      note="Scheduling warnings"
                      tone={d.openAlerts ? 'warn' : 'default'}
                    />
                  </ul>
                </section>
                <section className="ledger" aria-labelledby="ledger-safety">
                  <h2 id="ledger-safety">Safety and the accountability loop</h2>
                  <ul>
                    <LedgerRow
                      to="/admin/reports?status=unresolved"
                      label="Unresolved hazard reports"
                      value={d.openReports}
                      tone={d.openReports ? 'warn' : 'default'}
                    />
                    <LedgerRow
                      to="/admin/reports?status=unresolved&severity=critical"
                      label="Critical, unresolved"
                      value={d.criticalUnresolved}
                      tone={d.criticalUnresolved ? 'bad' : 'default'}
                    />
                    <LedgerRow
                      to="/admin/reports?status=outcome_verified"
                      label="Outcomes checked"
                      value={acc?.verifiedCount ?? '—'}
                      note={acc ? `${acc.verificationRatePercent}% verification rate` : undefined}
                    />
                    <LedgerRow
                      to="/admin/reports?status=follow_up_pending"
                      label="Follow-ups pending"
                      value={acc?.followUpPendingCount ?? '—'}
                      note={acc?.overdueFollowUps ? `${acc.overdueFollowUps} overdue` : undefined}
                      tone={acc?.overdueFollowUps ? 'warn' : 'default'}
                    />
                    <LedgerRow
                      to="/admin/reports"
                      label="Average time to acknowledge"
                      value={minutesLabel(acc?.meanTimeToAcknowledgeMinutes)}
                      note="From report to first review"
                    />
                    <LedgerRow
                      to="/admin/reports"
                      label="Average time to resolve"
                      value={minutesLabel(acc?.meanTimeToResolveMinutes)}
                      note={acc ? `${acc.reopenRatePercent}% reopen rate` : undefined}
                    />
                  </ul>
                </section>
              </div>

              <div className="console-grid">
                <Card title="Attendance trend" subtitle="Workers who checked in each day">
                  <BarChart data={trend} caption="Workers present per day" valueLabel="Workers present" />
                </Card>
                <Card title="Overtime trend" subtitle="Hours beyond the scheduled day, all workers">
                  <BarChart data={overtime} caption="Overtime hours per day" valueLabel="Overtime hours" format={(n) => `${Math.round(n * 10) / 10} h`} />
                </Card>
              </div>

              <div className="console-grid">
                <Card title="Recent activity">
                  {d.recentActivity.length === 0 ? (
                    <Empty>No recent activity.</Empty>
                  ) : (
                    <ul className="activity">
                      {d.recentActivity.map((a, i) => (
                        <li key={`${a.at}-${i}`}>
                          {a.link ? <Link to={a.link}>{a.text}</Link> : a.text}
                          <time dateTime={a.at}>{formatDateTime(a.at, me.org.timezone)}</time>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Feedback summary">
                  <p className="muted small">
                    {d.feedback.total} response(s) since {formatDate(d.range.from)}, excluding hidden. Averages are shown only when a topic has at least 3
                    ratings, so that one person's rating is harder to single out.
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Topic</th>
                          <th scope="col" className="num">
                            Responses
                          </th>
                          <th scope="col" className="num">
                            Avg rating
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.feedback.summaries.map((s) => (
                          <tr key={s.category}>
                            <td>{s.label}</td>
                            <td className="num">{s.count}</td>
                            <td className="num">{s.averageRating !== null ? `${s.averageRating} / 5` : <span className="muted">Too few</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="m-0">
                    <Link to="/admin/feedback">Review feedback</Link>
                  </p>
                </Card>
              </div>
            </>
          );
        }}
      </Async>
    </Page>
  );
}
