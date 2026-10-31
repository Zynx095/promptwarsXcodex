import { useState, type FormEvent } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { Link } from '../../lib/router';
import { useMe } from '../../lib/session';
import { useI18n } from '../../lib/i18n';
import { parseMajorToMinor, minorToMajorString } from '../../../shared/money';
import { getIndustry } from '../../../shared/industries';
import type { SkillDTO, WorkerDTO } from '../../../shared/types';
import { Async, Badge, Button, ConfirmDialog, Empty, ErrorBox, Field, Money, Notice, Page } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { SkillForm, SkillList } from '../../components/SkillList';
import { UserPlus } from 'lucide-react';

type StatusFilter = 'all' | 'active' | 'inactive';

export function AdminWorkers() {
  const me = useMe();
  const { t } = useI18n();
  const workers = useApi<{ items: WorkerDTO[] }>('/admin/workers');
  const [editing, setEditing] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [toggling, setToggling] = useState<WorkerDTO | null>(null);
  const [resetting, setResetting] = useState<WorkerDTO | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);

  // Add-worker sheet
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addJobTitle, setAddJobTitle] = useState('');
  const [addTeam, setAddTeam] = useState('');
  const [addRate, setAddRate] = useState('75');
  const [addPin, setAddPin] = useState('1234');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const industry = getIndustry(me.org.industry);
  const all = workers.data?.items ?? [];
  const counts: Record<StatusFilter, number> = { all: all.length, active: all.filter((w) => w.active).length, inactive: all.filter((w) => !w.active).length };

  async function handleAddWorker(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    const minor = parseMajorToMinor(addRate);
    if (minor === null || minor <= 0) {
      setAddError('Enter a valid hourly rate like 75 or 85.50.');
      return;
    }
    setAdding(true);
    try {
      await api('/admin/workers', {
        method: 'POST',
        body: {
          name: addName.trim(),
          phone: addPhone.trim(),
          jobTitle: addJobTitle.trim(),
          team: addTeam.trim(),
          hourlyRateMinor: minor,
          pin: addPin.trim(),
        },
      });

      setSaved(`${addName.trim()} was added. They can sign in with their phone number and PIN.`);
      setShowAddModal(false);
      setAddName('');
      setAddPhone('');
      setAddJobTitle('');
      setAddTeam('');
      setAddRate('75');
      setAddPin('1234');
      workers.reload();
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : 'Could not add worker.');
    } finally {
      setAdding(false);
    }
  }

  async function toggleWorkerActive(w: WorkerDTO) {
    setToggleBusy(true);
    try {
      await api(`/admin/workers/${w.id}`, { method: 'PATCH', body: { active: !w.active } });
      setSaved(`Account for ${w.name} ${w.active ? 'deactivated' : 'reactivated'}.`);
      workers.reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update status.');
    } finally {
      setToggleBusy(false);
      setToggling(null);
    }
  }

  async function resetPasskeys(w: WorkerDTO) {
    setToggleBusy(true);
    try {
      const { revoked } = await api<{ revoked: number }>(`/admin/workers/${w.id}/passkeys/revoke`, { method: 'POST', body: {} });
      setSaved(
        revoked
          ? `Removed ${revoked} passkey${revoked === 1 ? '' : 's'} for ${w.name}. They can check in with their sign-in and add a new phone.`
          : `${w.name} had no passkeys.`,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not reset passkeys.');
    } finally {
      setToggleBusy(false);
      setResetting(null);
    }
  }

  async function saveRate(w: WorkerDTO) {
    const minor = parseMajorToMinor(rate);
    if (minor === null || minor <= 0) {
      setError('Enter a rate like 85 or 85.50 (rupees per hour).');
      return;
    }
    try {
      await api(`/admin/workers/${w.id}`, { method: 'PATCH', body: { hourlyRateMinor: minor } });
      setEditing(null);
      setError(null);
      setSaved(`Hourly rate for ${w.name} updated. Future payslips use the new rate; issued payslips are unchanged.`);
      workers.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    }
  }

  return (
    <Page
      title="Workforce"
      actions={
        <Button variant="primary" onClick={() => setShowAddModal(true)} aria-haspopup="dialog">
          <UserPlus className="icon-sm" aria-hidden="true" />
          <span>Add worker</span>
        </Button>
      }
    >
      <div aria-live="polite">{saved ? <Notice kind="success">{saved}</Notice> : null}</div>
      {error && !editing ? <Notice kind="warning">{error}</Notice> : null}

      <div className="chip-filter" role="group" aria-label="Show workers">
        {(['all', 'active', 'inactive'] as const).map((f) => (
          <button key={f} type="button" className="chip-toggle" aria-pressed={statusFilter === f} onClick={() => setStatusFilter(f)}>
            {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Inactive'} <span className="figure">{counts[f]}</span>
          </button>
        ))}
      </div>

      <Async state={workers}>
        {(d) => {
          const list = d.items.filter((w) => {
            if (statusFilter === 'active') return w.active;
            if (statusFilter === 'inactive') return !w.active;
            return true;
          });

          return list.length === 0 ? (
            <Empty>No matching workers found.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">{industry.teamLabel}</th>
                    <th scope="col">Today</th>
                    <th scope="col" className="num">
                      Hourly rate
                    </th>
                    <th scope="col">Account</th>
                    <th scope="col">Records</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((w) => (
                    <tr key={w.id}>
                      <td>
                        <strong>{w.name}</strong>
                        <span className="cell-sub">
                          {w.jobTitle}, {w.phone}
                        </span>
                      </td>
                      <td>{w.team}</td>
                      <td>
                        <Badge tone={w.attendanceState === 'on_shift' ? 'good' : w.attendanceState === 'completed' ? 'info' : 'neutral'}>
                          {t(`state.${w.attendanceState}`)}
                        </Badge>
                      </td>
                      <td className="num">
                        {editing === w.id ? (
                          <form
                            className="rate-edit"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void saveRate(w);
                            }}
                          >
                            <label className="visually-hidden" htmlFor={`rate-${w.id}`}>
                              Hourly rate in rupees for {w.name}
                            </label>
                            <input
                              id={`rate-${w.id}`}
                              inputMode="decimal"
                              value={rate}
                              onChange={(e) => setRate(e.target.value)}
                              className="rate-input"
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? `rate-${w.id}-error` : undefined}
                            />
                            <span className="rate-edit-actions">
                              <Button type="submit" className="btn btn-primary btn-sm">
                                Save
                              </Button>
                              <Button variant="quiet" className="btn btn-quiet btn-sm" onClick={() => setEditing(null)}>
                                Cancel
                              </Button>
                            </span>
                            {error ? (
                              <p className="field-error" id={`rate-${w.id}-error`}>
                                {error}
                              </p>
                            ) : null}
                          </form>
                        ) : (
                          <>
                            <Money minor={w.hourlyRateMinor} />
                            <Button
                              variant="link"
                              className="btn btn-link btn-sm cell-action"
                              onClick={() => {
                                setEditing(w.id);
                                setRate(minorToMajorString(w.hourlyRateMinor));
                                setError(null);
                              }}
                            >
                              Edit rate<span className="visually-hidden"> for {w.name}</span>
                            </Button>
                          </>
                        )}
                      </td>
                      <td>
                        {w.active ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                        <Button variant="link" className="btn btn-link btn-sm cell-action" onClick={() => setToggling(w)} aria-haspopup="dialog">
                          {w.active ? 'Deactivate' : 'Reactivate'}
                          <span className="visually-hidden"> {w.name}</span>
                        </Button>
                        <Button variant="link" className="btn btn-link btn-sm cell-action" onClick={() => setResetting(w)} aria-haspopup="dialog">
                          Reset passkeys
                          <span className="visually-hidden"> for {w.name}</span>
                        </Button>
                      </td>
                      <td>
                        <ul className="cell-links">
                          <li>
                            <Link to={`/admin/shifts?workerId=${w.id}`}>Shifts</Link>
                          </li>
                          <li>
                            <Link to={`/admin/payslips?workerId=${w.id}`}>Payslips</Link>
                          </li>
                          <li>
                            <Link to={`/admin/workers/${w.id}/skills`}>Skills</Link>
                          </li>
                          <li>
                            <Link to={`/admin/alerts?workerId=${w.id}`}>Alerts</Link>
                          </li>
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Async>

      <ConfirmDialog
        isOpen={toggling !== null}
        title={toggling?.active ? `Deactivate ${toggling.name}?` : `Reactivate ${toggling?.name ?? ''}?`}
        message={
          toggling?.active
            ? 'They will be signed out and will not be able to sign in. Their shifts, payslips and reports stay on record, and you can reactivate the account later.'
            : 'They will be able to sign in and check in again.'
        }
        confirmLabel={toggling?.active ? 'Deactivate' : 'Reactivate'}
        variant={toggling?.active ? 'danger' : 'primary'}
        busy={toggleBusy}
        onConfirm={() => toggling && void toggleWorkerActive(toggling)}
        onCancel={() => setToggling(null)}
      />

      <ConfirmDialog
        isOpen={resetting !== null}
        title={`Reset passkeys for ${resetting?.name ?? ''}?`}
        message="Use this when the worker lost or replaced their phone. Their passkeys stop working, check-in falls back to their sign-in, and they can add the new phone. This is recorded in the audit log."
        confirmLabel="Reset passkeys"
        variant="danger"
        busy={toggleBusy}
        onConfirm={() => resetting && void resetPasskeys(resetting)}
        onCancel={() => setResetting(null)}
      />

      <Sheet
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add a worker"
        dismissible={!adding}
        footer={
          <div className="form-actions sheet-actions">
            <Button variant="quiet" onClick={() => setShowAddModal(false)} disabled={adding}>
              Cancel
            </Button>
            <Button type="submit" form="add-worker" busy={adding} disabled={adding || !addName.trim() || !addPhone.trim()}>
              Add worker
            </Button>
          </div>
        }
      >
        <form id="add-worker" onSubmit={handleAddWorker} noValidate>
          {addError ? <Notice kind="warning">{addError}</Notice> : null}
          <Field label="Full name">
            <input type="text" autoComplete="off" value={addName} onChange={(e) => setAddName(e.target.value)} maxLength={100} />
          </Field>
          <Field label="Phone number" hint="10 digits. The worker signs in with this number.">
            <input type="tel" inputMode="numeric" autoComplete="off" value={addPhone} onChange={(e) => setAddPhone(e.target.value.trim())} maxLength={10} />
          </Field>
          <div className="form-row">
            <Field label="Job title" optional>
              <input type="text" value={addJobTitle} onChange={(e) => setAddJobTitle(e.target.value)} maxLength={100} />
            </Field>
            <Field label={industry.teamLabel} optional>
              <input type="text" value={addTeam} onChange={(e) => setAddTeam(e.target.value)} maxLength={100} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="Hourly rate (₹)" hint="For example 75 or 85.50">
              <input type="text" inputMode="decimal" value={addRate} onChange={(e) => setAddRate(e.target.value)} />
            </Field>
            <Field label="First PIN" hint="4 to 6 digits. Give it to the worker in person.">
              <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={addPin} onChange={(e) => setAddPin(e.target.value)} />
            </Field>
          </div>
        </form>
      </Sheet>
    </Page>
  );
}

export function AdminWorkerSkills({ id }: { id: string }) {
  const workers = useApi<{ items: WorkerDTO[] }>('/admin/workers');
  const skills = useApi<{ items: SkillDTO[] }>(`/admin/workers/${encodeURIComponent(id)}/skills`);
  const [error, setError] = useState<ApiError | null>(null);
  const worker = workers.data?.items.find((w) => w.id === id);

  async function verify(s: SkillDTO, verified: boolean) {
    try {
      setError(null);
      await api(`/admin/skills/${s.id}`, { method: 'PATCH', body: { verified } });
      skills.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Could not update.'));
    }
  }

  return (
    <Page
      title={`Skill passport${worker ? `: ${worker.name}` : ''}`}
      actions={
        <Link to="/admin/workers" className="btn btn-secondary">
          Back to workforce
        </Link>
      }
    >
      {error ? <ErrorBox error={error} /> : null}
      <section aria-label="Skill passport entries">
        <Async state={skills}>{(d) => <SkillList skills={d.items} onVerify={verify} />}</Async>
        <p className="passport-note">
          Mark an entry as checked only after you have seen evidence (for example the original certificate). FairShift does not contact issuing bodies.
        </p>
      </section>
      <section className="passport-add" aria-labelledby="skill-add">
        <h2 id="skill-add" className="section-title">
          Add an employer-checked entry
        </h2>
        <SkillForm
          endpoint={`/admin/workers/${encodeURIComponent(id)}/skills`}
          onAdded={skills.reload}
          successText="Entry added and marked as checked by employer."
        />
      </section>
    </Page>
  );
}
