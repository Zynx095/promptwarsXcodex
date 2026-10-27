import { useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarCheck, Clock, ShieldAlert, Timer, UserCheck, Users } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { qs } from '../../lib/api';
import { Link } from '../../lib/router';
import { useMe } from '../../lib/session';
import { formatDate, formatDateTime, formatMinutes } from '../../lib/format';
import type { DashboardDTO } from '../../../shared/types';
import { Async, BarChart, Button, Card, Empty, Field, Notice, Page, type StatTone } from '../../components/ui';

function StatLink({ to, label, value, hint, icon, tone = 'default' }: { to: string; label: string; value: string | number; hint?: string; icon: ReactNode; tone?: StatTone }) {
  return (
    <Link to={to} className={`stat stat-${tone}`}>
      <span className="stat-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </Link>
  );
}

const ICON = { className: 'icon' } as const;

export function AdminDashboard() {
  const me = useMe();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [draft, setDraft] = useState({ from: '', to: '' });
  const dash = useApi<DashboardDTO>(`/admin/dashboard${qs(range)}`);

  return (
    <Page title="Workforce dashboard" description="Every figure is calculated from recorded shifts, hazard reports and alerts for the selected dates.">
      <form
        className="form-row card"
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
        <div className="field">
          <Button type="submit" variant="secondary">
            Update
          </Button>
        </div>
      </form>

      <Async state={dash}>
        {(d) => {
          const r = `from=${d.range.from}&to=${d.range.to}`;
          const trend = d.trend.map((p) => ({ label: p.date.slice(8), title: formatDate(p.date), value: p.present }));
          const overtime = d.trend.map((p) => ({ label: p.date.slice(8), title: formatDate(p.date), value: p.overtimeMinutes / 60 }));
          return (
            <>
              <p className="muted">
                Showing {formatDate(d.range.from)} – {formatDate(d.range.to)}.
              </p>
              {d.synthetic ? (
                <Notice kind="warning">These figures come from synthetic demonstration records. They are not real organisational statistics.</Notice>
              ) : null}
              <h2 className="section-title">Attendance</h2>
              <div className="stats">
                <StatLink to="/admin/workers" label="Active workers" value={d.totalWorkers} icon={<Users {...ICON} />} />
                <StatLink to="/admin/shifts?status=open" label="On shift now" value={d.onShiftNow} icon={<UserCheck {...ICON} />} />
                <StatLink to={`/admin/shifts?status=completed&${r}`} label="Completed shifts" value={d.completedShifts} icon={<CalendarCheck {...ICON} />} />
                <StatLink to={`/admin/shifts?${r}`} label="Hours worked" value={formatMinutes(d.workedMinutes)} icon={<Clock {...ICON} />} />
                <StatLink
                  to={`/admin/shifts?${r}`}
                  label="Overtime recorded"
                  value={formatMinutes(d.overtimeMinutes)}
                  hint={`${d.workersWithOvertime} worker(s) with overtime`}
                  icon={<Timer {...ICON} />}
                  tone={d.overtimeMinutes ? 'warn' : 'default'}
                />
                <StatLink to="/admin/alerts?status=open" label="Open hours alerts" value={d.openAlerts} hint="Scheduling warnings" icon={<AlertTriangle {...ICON} />} tone={d.openAlerts ? 'warn' : 'default'} />
              </div>
              <h2 className="section-title">Safety</h2>
              <div className="stats">
                <StatLink to="/admin/reports?status=unresolved" label="Unresolved hazard reports" value={d.openReports} icon={<ShieldAlert {...ICON} />} tone={d.openReports ? 'warn' : 'default'} />
                <StatLink
                  to="/admin/reports?status=unresolved&severity=critical"
                  label="Critical, unresolved"
                  value={d.criticalUnresolved}
                  icon={<ShieldAlert {...ICON} />}
                  tone={d.criticalUnresolved ? 'bad' : 'default'}
                />
              </div>

              <div className="grid">
                <Card title="Attendance trend" subtitle="Workers who checked in each day">
                  <BarChart data={trend} caption="Workers present per day" valueLabel="Workers present" />
                </Card>
                <Card title="Overtime trend" subtitle="Hours beyond the scheduled day, all workers">
                  <BarChart data={overtime} caption="Overtime hours per day" valueLabel="Overtime hours" format={(n) => `${Math.round(n * 10) / 10} h`} />
                </Card>
              </div>

              <div className="grid" style={{ marginTop: 16 }}>
                <Card title="Recent activity">
                  {d.recentActivity.length === 0 ? (
                    <Empty>No recent activity.</Empty>
                  ) : (
                    <ul className="list">
                      {d.recentActivity.map((a, i) => (
                        <li key={`${a.at}-${i}`}>
                          {a.link ? <Link to={a.link}>{a.text}</Link> : a.text}
                          <br />
                          <span className="muted small">{formatDateTime(a.at, me.org.timezone)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Feedback summary">
                  <p className="muted small">
                    {d.feedback.total} response(s) since {formatDate(d.range.from)}, excluding hidden. Averages are shown only when a topic has at least 3
                    ratings, to protect anonymity.
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
                  <p style={{ margin: 0 }}>
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
