// Pay check: verified hours at each worker's configured rate compared with the payments the
// employer has recorded, for one period. Shows the calculation, never moves money, and is not a
// legal finding. Payments are recorded here (append-only; mistakes are corrected by an adjustment).
import { useState, type FormEvent } from 'react';
import { Plus, Scale } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { api, ApiError, qs } from '../../lib/api';
import { useRouter } from '../../lib/router';
import { useMe } from '../../lib/session';
import { useMoney } from '../../lib/i18n';
import { formatDate } from '../../lib/format';
import { minorToMajorString, parseMajorToMinor } from '../../../shared/money';
import { addDays, localDate } from '../../../shared/time';
import type { PayCheckDTO, PayCheckSummaryDTO, PaymentMethod, ShortfallStatus } from '../../../shared/types';
import { Async, Button, Empty, ErrorBox, Field, Notice, Page } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { lastFullWeek, PayCheckDetail, ShortfallBadge } from '../../components/PayCheck';

const STATUS_LABEL: Record<ShortfallStatus, string> = {
  requires_review: 'Requires review',
  possible_shortfall: 'Possible shortfall',
  no_discrepancy: 'No discrepancy identified',
  unavailable: 'Cannot be calculated',
};
const STATUS_ORDER: ShortfallStatus[] = ['requires_review', 'possible_shortfall', 'no_discrepancy', 'unavailable'];
const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
];

function WorkerCheck({ workerId, from, to }: { workerId: string; from: string; to: string }) {
  const check = useApi<PayCheckDTO>(`/admin/pay-check/${encodeURIComponent(workerId)}${qs({ from, to })}`);
  return <Async state={check}>{(c) => <PayCheckDetail check={c} />}</Async>;
}

function RecordPayment({
  worker,
  period,
  onDone,
  onCancel,
}: {
  worker: { workerId: string; workerName: string; outstandingMinor: number };
  period: { from: string; to: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const me = useMe();
  const today = localDate(new Date(), me.org.timezone);
  const [form, setForm] = useState({
    kind: 'payment' as 'payment' | 'adjustment',
    amount: worker.outstandingMinor > 0 ? minorToMajorString(worker.outstandingMinor) : '',
    method: 'bank_transfer' as PaymentMethod,
    paidOn: today < period.to ? today : period.to,
    periodStart: period.from,
    periodEnd: period.to,
    reference: '',
    note: '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const f = error?.fields ?? {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    const raw = form.amount.trim();
    const negative = form.kind === 'adjustment' && raw.startsWith('-');
    const minor = parseMajorToMinor(negative ? raw.slice(1) : raw);
    if (minor === null || minor === 0) {
      setError(new ApiError(400, 'VALIDATION', 'Enter an amount in rupees, for example 1250.50.', { amountMinor: 'Enter an amount in rupees.' }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/admin/payments', {
        method: 'POST',
        body: { ...form, amount: undefined, workerId: worker.workerId, amountMinor: negative ? -minor : minor },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'The payment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="payment-form">
      <p className="muted">
        Record a payment already made to <strong>{worker.workerName}</strong> outside FairShift. FairShift does not transfer money. Entries cannot be edited or
        deleted; correct a mistake with an adjustment.
      </p>
      {error && !Object.keys(f).length ? <ErrorBox error={error} /> : null}
      <fieldset className="segmented-field">
        <legend>Type</legend>
        <label className="check">
          <input type="radio" name="kind" checked={form.kind === 'payment'} onChange={() => setForm({ ...form, kind: 'payment' })} />
          <span>Payment</span>
        </label>
        <label className="check">
          <input type="radio" name="kind" checked={form.kind === 'adjustment'} onChange={() => setForm({ ...form, kind: 'adjustment' })} />
          <span>Adjustment (may be negative)</span>
        </label>
      </fieldset>
      <Field
        label="Amount (₹)"
        hint={form.kind === 'adjustment' ? 'Use a minus sign to reduce an earlier entry, e.g. -500.' : undefined}
        error={f['amountMinor']}
      >
        <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
      </Field>
      <div className="form-row">
        <Field label="Method">
          <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paid on" error={f['paidOn']}>
          <input type="date" value={form.paidOn} max={today} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Covers from" error={f['periodStart']}>
          <input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
        </Field>
        <Field label="Covers to" error={f['periodEnd']}>
          <input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
        </Field>
      </div>
      <Field label="Reference" optional hint="Transaction ID, voucher or cheque number." error={f['reference']}>
        <input value={form.reference} maxLength={80} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
      </Field>
      <Field label="Note" optional={form.kind === 'payment'} error={f['note']}>
        <textarea value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </Field>
      <div className="form-actions sheet-actions">
        <Button variant="quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          Record {form.kind}
        </Button>
      </div>
    </form>
  );
}

export function AdminPayCheck() {
  const me = useMe();
  const money = useMoney();
  const { search, navigate } = useRouter();
  const today = localDate(new Date(), me.org.timezone);
  const week = lastFullWeek(today);
  const firstThis = `${today.slice(0, 8)}01`;
  const lastPrev = addDays(firstThis, -1);
  const presets = [
    { key: 'week', label: 'Last full week', ...week },
    { key: 'month', label: 'This month', from: firstThis, to: today },
    { key: 'prev', label: 'Last month', from: `${lastPrev.slice(0, 8)}01`, to: lastPrev },
  ];
  const from = search.get('from') ?? week.from;
  const to = search.get('to') ?? week.to;
  const [draft, setDraft] = useState({ from, to });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ShortfallStatus>('all');
  const [detail, setDetail] = useState<string | null>(search.get('worker'));
  const [paying, setPaying] = useState<{ workerId: string; workerName: string; outstandingMinor: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const summary = useApi<PayCheckSummaryDTO>(`/admin/pay-check${qs({ from, to })}`);

  const go = (r: { from: string; to: string }) => {
    setDraft(r);
    navigate(`/admin/pay-check${qs(r)}`, { replace: true });
  };

  return (
    <Page
      title="Pay check"
      description="Verified hours at each worker’s configured rate compared with the payments you have recorded. A gap is a reason to check the records with the worker, not a legal finding."
    >
      <div className="range-bar">
        <div className="chip-filter" role="group" aria-label="Period">
          {presets.map((p) => (
            <button key={p.key} type="button" className="chip-toggle" aria-pressed={p.from === from && p.to === to} onClick={() => go(p)}>
              {p.label}
            </button>
          ))}
        </div>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.from && draft.to) go(draft);
          }}
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
      </div>
      <div aria-live="polite">{message ? <Notice kind="success">{message}</Notice> : null}</div>

      <Async state={summary}>
        {(d) => {
          const q = query.trim().toLowerCase();
          const rows = d.items
            .filter((i) => status === 'all' || i.status === status)
            .filter((i) => !q || [i.workerName, i.jobTitle, i.team].some((v) => v.toLowerCase().includes(q)))
            .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.outstandingMinor - a.outstandingMinor);
          return (
            <>
              <p className="range-note">
                {formatDate(d.period.from)} – {formatDate(d.period.to)}. Expected pay is the take-home amount after the configured deductions, from closed
                shifts only.
              </p>
              {!d.paymentsRecorded ? (
                <Notice kind="info">
                  No payments are recorded in FairShift yet, so every worker with verified hours shows as needing review. Record payments to compare.
                </Notice>
              ) : null}
              <div className="attention-tiles" role="group" aria-label="Workers by pay check status">
                {STATUS_ORDER.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`attention-tile tone-${k === 'requires_review' ? 'bad' : k === 'possible_shortfall' ? 'warn' : k === 'no_discrepancy' ? 'good' : 'neutral'}`}
                    aria-pressed={status === k}
                    onClick={() => setStatus(status === k ? 'all' : k)}
                  >
                    <span className="attention-tile-label">{STATUS_LABEL[k]}</span>
                    <span className="attention-tile-value figure">{d.counts[k]}</span>
                  </button>
                ))}
              </div>
              <div className="table-tools">
                <Field label="Search workers">
                  <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, job or team" />
                </Field>
              </div>
              {rows.length === 0 ? (
                <Empty>No workers match these filters.</Empty>
              ) : (
                <div className="table-wrap">
                  <table aria-label="Pay check by worker">
                    <thead>
                      <tr>
                        <th scope="col">Worker</th>
                        <th scope="col" className="num">
                          Expected
                        </th>
                        <th scope="col" className="num">
                          Recorded
                        </th>
                        <th scope="col" className="num">
                          Possible shortfall
                        </th>
                        <th scope="col">Status</th>
                        <th scope="col">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((i) => (
                        <tr key={i.workerId}>
                          <td>
                            <strong>{i.workerName}</strong>
                            <span className="cell-sub">{[i.jobTitle, i.team].filter(Boolean).join(', ')}</span>
                          </td>
                          <td className="num figure">{i.expectedNetMinor === null ? '—' : money(i.expectedNetMinor, d.currency)}</td>
                          <td className="num figure">{money(i.recordedMinor, d.currency)}</td>
                          <td className={`num figure${i.outstandingMinor > 0 ? ' tone-bad' : ''}`}>{money(i.outstandingMinor, d.currency)}</td>
                          <td>
                            <ShortfallBadge status={i.status} />
                          </td>
                          <td className="cell-end">
                            <Button variant="secondary" className="btn btn-secondary btn-sm" aria-haspopup="dialog" onClick={() => setDetail(i.workerId)}>
                              Calculation<span className="visually-hidden"> for {i.workerName}</span>
                            </Button>{' '}
                            <Button
                              variant="secondary"
                              className="btn btn-secondary btn-sm"
                              aria-haspopup="dialog"
                              onClick={() => setPaying({ workerId: i.workerId, workerName: i.workerName, outstandingMinor: i.outstandingMinor })}
                            >
                              <Plus className="icon-sm" aria-hidden="true" />
                              Record payment<span className="visually-hidden"> for {i.workerName}</span>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <section className="card retention-rules" aria-labelledby="paycheck-rules">
                <h2 id="paycheck-rules" className="card-title">
                  <Scale className="icon" aria-hidden="true" /> How the status is decided
                </h2>
                <ul>
                  <li>
                    Expected = closed shifts in the period × the worker’s configured hourly rate, with overtime and deductions exactly as on a payslip, in whole
                    paise.
                  </li>
                  <li>Recorded = payments and adjustments entered here whose covered dates fall inside the period.</li>
                  <li>
                    No gap: no discrepancy identified. A gap under 10% of expected: possible shortfall. 10% or more, or nothing recorded: requires review.
                  </li>
                  <li>
                    No configured rate: the calculation cannot be completed reliably. FairShift does not apply any statutory minimum wage, which varies by
                    state, sector and date.
                  </li>
                </ul>
              </section>
            </>
          );
        }}
      </Async>

      <Sheet open={detail !== null} onClose={() => setDetail(null)} title="Pay check calculation" className="paycheck-sheet">
        {detail ? <WorkerCheck workerId={detail} from={from} to={to} /> : null}
      </Sheet>
      <Sheet open={paying !== null} onClose={() => setPaying(null)} title="Record a payment">
        {paying ? (
          <RecordPayment
            worker={paying}
            period={{ from, to }}
            onCancel={() => setPaying(null)}
            onDone={() => {
              setMessage(`Payment recorded for ${paying.workerName}. It is in the audit log.`);
              setPaying(null);
              summary.reload();
            }}
          />
        ) : null}
      </Sheet>
    </Page>
  );
}
