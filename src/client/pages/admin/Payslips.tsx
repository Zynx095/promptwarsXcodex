import { useState, type FormEvent } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiError, qs } from '../../lib/api';
import { Link, useRouter } from '../../lib/router';
import { formatDate } from '../../lib/format';
import type { Paged, PayslipDTO, PayslipListItem, WorkerDTO } from '../../../shared/types';
import { Async, Button, Card, Empty, ErrorBox, Field, Money, Notice, Page, Pager } from '../../components/ui';
import { PayslipBreakdown } from '../../components/PayslipBreakdown';
import { Download, Printer } from 'lucide-react';

const LIMIT = 25;

export function AdminPayslips() {
  const { search, navigate } = useRouter();
  const workerId = search.get('workerId') ?? '';
  const offset = Number(search.get('offset') ?? 0) || 0;
  const workers = useApi<{ items: WorkerDTO[] }>('/admin/workers');
  const list = useApi<Paged<PayslipListItem>>(`/admin/payslips${qs({ workerId, offset, limit: LIMIT })}`);

  const [form, setForm] = useState({ workerId, from: '', to: '' });
  const [preview, setPreview] = useState<PayslipDTO | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [issued, setIssued] = useState<PayslipDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const f = error?.fields ?? {};

  async function doPreview(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssued(null);
    setPreview(null);
    try {
      setPreview(await api<PayslipDTO>(`/admin/payslips/preview${qs(form)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Could not calculate.'));
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const slip = await api<PayslipDTO>('/admin/payslips', { method: 'POST', body: form });
      setIssued(slip);
      setPreview(null);
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Could not issue.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Payslips"
      actions={
        <a href="/api/admin/payslips/export.csv" download="fairshift_payroll.csv" className="btn btn-secondary">
          <Download className="icon-sm" aria-hidden="true" />
          <span>Export payroll CSV</span>
        </a>
      }
    >
      <Card title="Calculate and issue a payslip">
        <p className="muted small">
          Pay is calculated from recorded shifts, the worker&apos;s hourly rate and your pay rules. Issued payslips are fixed snapshots; later corrections do
          not change them. FairShift is not connected to a payroll or banking system.
        </p>
        <form onSubmit={doPreview} noValidate className="form-row">
          <Field label="Worker" error={f['workerId']}>
            <select value={form.workerId} onChange={(e) => setForm({ ...form, workerId: e.target.value })}>
              <option value="">Choose…</option>
              {workers.data?.items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period start" error={f['from']}>
            <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          </Field>
          <Field label="Period end" error={f['to']}>
            <input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          </Field>
          <div className="field">
            <Button type="submit" variant="secondary" busy={busy}>
              Preview
            </Button>
          </div>
        </form>
        {error && !Object.keys(f).length ? <ErrorBox error={error} /> : null}
        {issued ? (
          <Notice kind="success">
            Payslip issued for {issued.workerName}. <Link to={`/admin/payslips/${issued.id}`}>View payslip</Link>
          </Notice>
        ) : null}
        {preview ? (
          <>
            <PayslipBreakdown slip={preview} />
            <div className="form-actions">
              <Button onClick={issue} busy={busy} disabled={preview.breakdown.openShiftsExcluded > 0}>
                Issue this payslip
              </Button>
              <Button variant="secondary" onClick={() => setPreview(null)}>
                Discard preview
              </Button>
            </div>
          </>
        ) : null}
      </Card>

      <Card title="Issued payslips">
        <div className="form-row">
          <Field label="Show worker">
            <select value={workerId} onChange={(e) => navigate(`/admin/payslips${qs({ workerId: e.target.value })}`)}>
              <option value="">All workers</option>
              {workers.data?.items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Async state={list}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>No payslips issued.</Empty>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Worker</th>
                        <th scope="col">Period</th>
                        <th scope="col" className="num">
                          Gross
                        </th>
                        <th scope="col" className="num">
                          Net
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <Link to={`/admin/payslips/${p.id}`}>{p.workerName}</Link>
                            {p.synthetic ? <span className="muted small"> (synthetic)</span> : null}
                          </td>
                          <td>
                            {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                          </td>
                          <td className="num">
                            <Money minor={p.grossPayMinor} />
                          </td>
                          <td className="num">
                            <Money minor={p.netPayMinor} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  total={d.total}
                  limit={d.limit}
                  offset={d.offset}
                  onChange={(o) => navigate(`/admin/payslips${qs({ workerId, offset: o || undefined })}`)}
                />
              </>
            )
          }
        </Async>
      </Card>
    </Page>
  );
}

export function AdminPayslipView({ id }: { id: string }) {
  const slip = useApi<PayslipDTO>(`/admin/payslips/${encodeURIComponent(id)}`);
  return (
    <Page
      title="Payslip"
      actions={
        <div className="btn-group">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="icon-sm" aria-hidden="true" />
            <span>Print</span>
          </Button>
          <Link to="/admin/payslips" className="btn btn-secondary">
            Back to payslips
          </Link>
        </div>
      }
    >
      <Card>
        <Async state={slip}>{(s) => <PayslipBreakdown slip={s} />}</Async>
      </Card>
    </Page>
  );
}
