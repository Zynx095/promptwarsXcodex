import { useState, type FormEvent } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiError, qs } from '../../lib/api';
import { useRouter } from '../../lib/router';
import { useMe } from '../../lib/session';
import { formatDate, formatDateTime, formatMinutes } from '../../lib/format';
import { fromLocalInputValue, toLocalInputValue } from '../../../shared/time';
import type { Paged, ShiftDTO, WorkerDTO } from '../../../shared/types';
import { Async, Badge, Button, Card, Empty, ErrorBox, Field, Notice, Page, Pager } from '../../components/ui';
import { SiteCodeCard } from '../../components/SiteCodeCard';

const LIMIT = 25;

export function AdminShifts() {
  const { search, navigate } = useRouter();
  const filters = {
    workerId: search.get('workerId') ?? '',
    status: search.get('status') ?? '',
    from: search.get('from') ?? '',
    to: search.get('to') ?? '',
    offset: Number(search.get('offset') ?? 0) || 0,
  };
  const [draft, setDraft] = useState(filters);
  const workers = useApi<{ items: WorkerDTO[] }>('/admin/workers');
  const shifts = useApi<Paged<ShiftDTO>>(`/admin/shifts${qs({ ...filters, limit: LIMIT })}`);
  const [editing, setEditing] = useState<ShiftDTO | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = (f: typeof filters) => navigate(`/admin/shifts${qs({ ...f, offset: f.offset || undefined })}`);

  return (
    <Page title="Shift and attendance records" description="Every recorded shift. Corrections need a reason and go to the audit log.">
      <SiteCodeCard />
      <form
        className="filter-form"
        aria-label="Filter shifts"
        onSubmit={(e) => {
          e.preventDefault();
          go({ ...draft, offset: 0 });
        }}
      >
        <Field label="Worker">
          <select value={draft.workerId} onChange={(e) => setDraft({ ...draft, workerId: e.target.value })}>
            <option value="">All workers</option>
            {workers.data?.items.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="">Any</option>
            <option value="open">On shift (open)</option>
            <option value="completed">Completed</option>
          </select>
        </Field>
        <Field label="From">
          <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </Field>
        <Field label="To">
          <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </Field>
        <div className="filter-submit">
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </div>
      </form>

      {notice ? <Notice kind="success">{notice}</Notice> : null}
      {editing ? (
        <CorrectionForm
          shift={editing}
          onCancel={() => setEditing(null)}
          onSaved={(s) => {
            setEditing(null);
            setNotice(`Shift for ${s.workerName ?? 'worker'} corrected. The change is recorded in the audit log.`);
            shifts.reload();
          }}
        />
      ) : null}

      <Card>
        <Async state={shifts}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>No shifts match these filters.</Empty>
            ) : (
              <>
                <ShiftTable shifts={d.items} onCorrect={setEditing} />
                <Pager total={d.total} limit={d.limit} offset={d.offset} onChange={(offset) => go({ ...filters, offset })} />
              </>
            )
          }
        </Async>
      </Card>
    </Page>
  );
}

function ShiftTable({ shifts, onCorrect }: { shifts: ShiftDTO[]; onCorrect: (s: ShiftDTO) => void }) {
  const me = useMe();
  const tz = me.org.timezone;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Worker</th>
            <th scope="col">Date</th>
            <th scope="col">In</th>
            <th scope="col">Out</th>
            <th scope="col" className="num">
              Duration
            </th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((s) => (
            <tr key={s.id}>
              <td>
                {s.workerName}
                {s.corrected ? (
                  <>
                    {' '}
                    <Badge tone="info">Corrected</Badge>
                  </>
                ) : null}
                {s.synthetic ? <span className="muted small"> (synthetic)</span> : null}
              </td>
              <td>{formatDate(s.localDate)}</td>
              <td>{formatDateTime(s.checkInAt, tz)}</td>
              <td>{s.checkOutAt ? formatDateTime(s.checkOutAt, tz) : <Badge tone="good">On shift</Badge>}</td>
              <td className="num">{s.durationMinutes !== null ? formatMinutes(s.durationMinutes) : '—'}</td>
              <td>
                <Button variant="link" onClick={() => onCorrect(s)} aria-label={`Correct shift for ${s.workerName} on ${s.localDate}`}>
                  Correct
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CorrectionForm({ shift, onCancel, onSaved }: { shift: ShiftDTO; onCancel: () => void; onSaved: (s: ShiftDTO) => void }) {
  const me = useMe();
  const tz = me.org.timezone;
  const [checkIn, setCheckIn] = useState(toLocalInputValue(shift.checkInAt, tz));
  const [checkOut, setCheckOut] = useState(shift.checkOutAt ? toLocalInputValue(shift.checkOutAt, tz) : '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const f = error?.fields ?? {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    const inIso = fromLocalInputValue(checkIn, tz);
    const outIso = checkOut ? fromLocalInputValue(checkOut, tz) : null;
    if (!inIso || (checkOut && !outIso)) {
      setError(new ApiError(400, 'VALIDATION_ERROR', 'Enter valid dates and times.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<ShiftDTO>(`/admin/shifts/${shift.id}`, { method: 'PATCH', body: { checkInAt: inIso, checkOutAt: outIso, reason } }));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Could not save the correction.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Correct shift: ${shift.workerName ?? ''}`}>
      <p className="muted small">
        Times are in the organisation timezone ({tz}). The original values, new values, your reason and your name are recorded in the audit log.
      </p>
      <form onSubmit={submit} noValidate>
        {error && !Object.keys(f).length ? <ErrorBox error={error} /> : null}
        <div className="form-row">
          <Field label="Check-in" error={f['checkInAt']}>
            <input type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </Field>
          <Field label="Check-out" hint="Leave empty if the worker is still on shift." optional error={f['checkOutAt']}>
            <input type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason for correction" hint="For example: worker forgot to check out; confirmed with supervisor." error={f['reason']}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <div className="form-actions">
          <Button type="submit" busy={busy}>
            Save correction
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
