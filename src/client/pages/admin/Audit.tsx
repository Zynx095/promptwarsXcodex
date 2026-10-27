import { useApi } from '../../lib/useApi';
import { qs } from '../../lib/api';
import { useRouter } from '../../lib/router';
import { useMe } from '../../lib/session';
import { formatDateTime } from '../../lib/format';
import type { AuditEventDTO, Paged } from '../../../shared/types';
import { Async, Card, Empty, Field, Page, Pager } from '../../components/ui';

const LIMIT = 30;
const ENTITY_TYPES = ['shift', 'safety_report', 'payslip', 'worker', 'org_settings', 'skill', 'feedback'];

function describe(value: unknown, tz: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'object') return String(value);
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? formatDateTime(v, tz) : JSON.stringify(v)}`)
    .join('; ');
}

export function AdminAudit() {
  const me = useMe();
  const { search, navigate } = useRouter();
  const entityType = search.get('entityType') ?? '';
  const offset = Number(search.get('offset') ?? 0) || 0;
  const audit = useApi<Paged<AuditEventDTO>>(`/admin/audit${qs({ entityType, offset, limit: LIMIT })}`);

  return (
    <Page title="Audit log">
      <p className="muted">
        Every check-in, check-out, correction, report status change, payslip issue and rule change is recorded here with who did it and when. Confidential
        report submissions are recorded without the reporter.
      </p>
      <div className="card form-row">
        <Field label="Record type">
          <select value={entityType} onChange={(e) => navigate(`/admin/audit${qs({ entityType: e.target.value })}`)}>
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Card>
        <Async state={audit}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>No audit events.</Empty>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">When</th>
                        <th scope="col">Who</th>
                        <th scope="col">What</th>
                        <th scope="col">Before → After</th>
                        <th scope="col">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((a) => (
                        <tr key={a.id}>
                          <td className="small">{formatDateTime(a.createdAt, me.org.timezone)}</td>
                          <td>{a.actorName}</td>
                          <td>
                            {a.entityType.replace('_', ' ')}: {a.action.replace('_', ' ')}
                          </td>
                          <td className="small">
                            {a.before ? (
                              <>
                                {describe(a.before, me.org.timezone)}
                                <br />→{' '}
                              </>
                            ) : null}
                            {describe(a.after, me.org.timezone)}
                          </td>
                          <td className="small">{a.reason ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  total={d.total}
                  limit={d.limit}
                  offset={d.offset}
                  onChange={(o) => navigate(`/admin/audit${qs({ entityType, offset: o || undefined })}`)}
                />
              </>
            )
          }
        </Async>
      </Card>
    </Page>
  );
}
