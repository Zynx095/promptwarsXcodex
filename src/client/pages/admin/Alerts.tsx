import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiError, qs } from '../../lib/api';
import { useRouter } from '../../lib/router';
import { useMe } from '../../lib/session';
import { formatDateTime } from '../../lib/format';
import { RULE_LABELS } from '../../../domain/fatigue';
import type { AlertDTO } from '../../../shared/types';
import { Async, Badge, Button, Card, Empty, ErrorBox, Field, Page } from '../../components/ui';

export function AdminAlerts() {
  const me = useMe();
  const { search, navigate } = useRouter();
  const status = search.get('status') ?? '';
  const workerId = search.get('workerId') ?? '';
  const alerts = useApi<{ items: AlertDTO[] }>(`/admin/alerts${qs({ status, workerId })}`);
  const [error, setError] = useState<ApiError | null>(null);

  async function acknowledge(a: AlertDTO) {
    try {
      setError(null);
      await api(`/admin/alerts/${a.id}/acknowledge`, { method: 'POST' });
      alerts.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Could not acknowledge.'));
    }
  }

  return (
    <Page title="Excessive-hours alerts">
      <p className="muted">
        Scheduling warnings generated from recorded shifts using your organisation&apos;s thresholds (see Pay &amp; hours rules). They indicate possible fatigue
        risk; they are not medical assessments. Workers can see alerts about their own hours.
      </p>
      <div className="filter-form">
        <Field label="Status">
          <select value={status} onChange={(e) => navigate(`/admin/alerts${qs({ status: e.target.value, workerId })}`)}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
          </select>
        </Field>
        {workerId ? (
          <div className="filter-submit">
            <Button variant="secondary" onClick={() => navigate(`/admin/alerts${qs({ status })}`)}>
              Show all workers
            </Button>
          </div>
        ) : null}
      </div>
      {error ? <ErrorBox error={error} /> : null}
      <Card>
        <Async state={alerts}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>No alerts.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Worker</th>
                      <th scope="col">Rule</th>
                      <th scope="col">Details</th>
                      <th scope="col">Generated</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((a) => (
                      <tr key={a.id}>
                        <td>{a.workerName}</td>
                        <td>{RULE_LABELS[a.rule]}</td>
                        <td className="small">{a.details}</td>
                        <td className="small">{formatDateTime(a.createdAt, me.org.timezone)}</td>
                        <td>
                          {a.status === 'open' ? (
                            <>
                              <Badge tone="warn">Open</Badge>
                              <br />
                              <Button variant="link" onClick={() => acknowledge(a)}>
                                Acknowledge
                              </Button>
                            </>
                          ) : (
                            <Badge tone="neutral">Acknowledged</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </Card>
    </Page>
  );
}
