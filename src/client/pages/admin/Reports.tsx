import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { qs } from '../../lib/api';
import { Link, useRouter } from '../../lib/router';
import { useMe } from '../../lib/session';
import { formatDateTime } from '../../lib/format';
import { getIndustry } from '../../../shared/industries';
import { REPORT_STATUSES, SEVERITIES, type Paged, type SafetyReportDTO } from '../../../shared/types';
import { Async, Badge, Button, Empty, Field, Page, Pager, ReportStatusBadge, SeverityBadge } from '../../components/ui';
import { LifecycleBar } from '../../components/Lifecycle';
import { ReportDetail } from '../../components/ReportDetail';
import { SafeSignalView } from '../../components/SafeSignalView';

const LIMIT = 25;
const SEVERITY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const STATUS_LABEL: Record<string, string> = {
  unresolved: 'All unresolved',
  submitted: 'Submitted (not reviewed)',
  acknowledged: 'Acknowledged',
  in_progress: 'In progress',
  resolved: 'Resolved',
  follow_up_pending: 'Follow-up pending',
  outcome_verified: 'Outcome verified',
  reopened: 'Reopened',
};

export function AdminReports() {
  const me = useMe();
  const { search, navigate } = useRouter();
  const industry = getIndustry(me.org.industry);
  const filters = {
    status: search.get('status') ?? '',
    severity: search.get('severity') ?? '',
    category: search.get('category') ?? '',
    from: search.get('from') ?? '',
    to: search.get('to') ?? '',
    offset: Number(search.get('offset') ?? 0) || 0,
  };
  const [draft, setDraft] = useState(filters);
  const reports = useApi<Paged<SafetyReportDTO>>(`/admin/reports${qs({ ...filters, limit: LIMIT })}`);
  const go = (f: typeof filters) => navigate(`/admin/reports${qs({ ...f, offset: f.offset || undefined })}`);

  return (
    <Page
      title="Safety report queue"
      description={`${industry.label}. Reports are hazards raised by workers; they are not verified incidents. A report is resolved only when an administrator records the fix.`}
    >
      <SafeSignalView
        onSelectCategory={(cat) => {
          setDraft((prev) => ({ ...prev, category: cat, offset: 0 }));
          go({ ...draft, category: cat, offset: 0 });
        }}
      />
      <form
        className="filter-form"
        aria-label="Filter reports"
        onSubmit={(e) => {
          e.preventDefault();
          go({ ...draft, offset: 0 });
        }}
      >
        <Field label="Status">
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="">Any</option>
            {['unresolved', ...REPORT_STATUSES].map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Severity">
          <select value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
            <option value="">Any</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            <option value="">Any</option>
            {industry.hazardCategories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reported from">
          <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </Field>
        <Field label="Reported to">
          <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </Field>
        <div className="filter-submit">
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </div>
      </form>
      <section aria-label="Reports">
        <Async state={reports}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>No reports match these filters.</Empty>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Report</th>
                        <th scope="col">Severity</th>
                        <th scope="col">Status</th>
                        <th scope="col">Assigned to</th>
                        <th scope="col">Reported</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Link to={`/admin/reports/${r.id}`}>{r.title}</Link>
                            <span className="cell-sub">
                              {industry.hazardCategories.find((c) => c.key === r.category)?.label ?? r.category}, {r.location}
                            </span>
                            {r.confidential ? <Badge tone="info">Confidential</Badge> : null}
                          </td>
                          <td>
                            <SeverityBadge severity={r.severity} />
                          </td>
                          <td>
                            <ReportStatusBadge status={r.status} />
                            <span className="cell-life">
                              <LifecycleBar status={r.status} />
                            </span>
                            {r.followUpDate && r.status === 'follow_up_pending' && r.followUpDate < new Date().toISOString().slice(0, 10) ? (
                              <Badge tone="warn">Follow-up overdue</Badge>
                            ) : null}
                            {r.verifiedBy ? <span className="cell-sub">Checked by {r.verifiedBy}</span> : null}
                          </td>

                          <td>{r.assignee ?? <span className="muted">—</span>}</td>
                          <td className="cell-time">{formatDateTime(r.createdAt, me.org.timezone)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager total={d.total} limit={d.limit} offset={d.offset} onChange={(offset) => go({ ...filters, offset })} />
              </>
            )
          }
        </Async>
      </section>
    </Page>
  );
}

export function AdminReportView({ id }: { id: string }) {
  const report = useApi<SafetyReportDTO>(`/admin/reports/${encodeURIComponent(id)}`);
  return (
    <Page
      title="Safety report"
      actions={
        <Link to="/admin/reports" className="btn btn-secondary">
          Back to queue
        </Link>
      }
    >
      <Async state={report}>{(r) => <ReportDetail report={r} onUpdated={() => report.reload()} />}</Async>
    </Page>
  );
}
