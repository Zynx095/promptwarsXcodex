import { useState, type FormEvent } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { Link } from '../../lib/router';
import { useMe } from '../../lib/session';
import { useI18n } from '../../lib/i18n';
import { parseMajorToMinor, minorToMajorString } from '../../../shared/money';
import { getIndustry } from '../../../shared/industries';
import type { SkillDTO, WorkerDTO } from '../../../shared/types';
import { Async, Badge, Button, Card, Empty, ErrorBox, Money, Notice, Page } from '../../components/ui';
import { SkillForm, SkillList } from '../../components/SkillList';
import { UserPlus, X } from 'lucide-react';

export function AdminWorkers() {
  const me = useMe();
  const { t } = useI18n();
  const workers = useApi<{ items: WorkerDTO[] }>('/admin/workers');
  const [editing, setEditing] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Add Worker Modal State
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

      setSaved(`Worker "${addName.trim()}" successfully provisioned.`);
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
    try {
      await api(`/admin/workers/${w.id}`, { method: 'PATCH', body: { active: !w.active } });
      setSaved(`Account for ${w.name} ${w.active ? 'deactivated' : 'reactivated'}.`);
      workers.reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update status.');
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
        <Button variant="primary" onClick={() => setShowAddModal(true)}>
          <UserPlus className="icon-sm" aria-hidden="true" />
          <span>Add Worker</span>
        </Button>
      }
    >
      {saved ? <Notice kind="success">{saved}</Notice> : null}
      {error ? <Notice kind="warning">{error}</Notice> : null}

      <div className="filter-pill-group mb-3">
        <button type="button" className={`filter-pill ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
          All ({(workers.data?.items ?? []).length})
        </button>
        <button type="button" className={`filter-pill ${statusFilter === 'active' ? 'active' : ''}`} onClick={() => setStatusFilter('active')}>
          Active ({(workers.data?.items ?? []).filter((w) => w.active).length})
        </button>
        <button type="button" className={`filter-pill ${statusFilter === 'inactive' ? 'active' : ''}`} onClick={() => setStatusFilter('inactive')}>
          Inactive ({(workers.data?.items ?? []).filter((w) => !w.active).length})
        </button>
      </div>

      <Card>
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
                      <th scope="col">Status</th>
                      <th scope="col">Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((w) => (
                      <tr key={w.id}>
                        <td>
                          <strong>{w.name}</strong>
                          <br />
                          <span className="muted small">
                            {w.jobTitle} · {w.phone}
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
                              onSubmit={(e) => {
                                e.preventDefault();
                                void saveRate(w);
                              }}
                            >
                              <label className="visually-hidden" htmlFor={`rate-${w.id}`}>
                                Hourly rate in rupees for {w.name}
                              </label>
                              <input id={`rate-${w.id}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="rate-input" />
                              <div className="form-actions form-actions-end">
                                <Button type="submit">Save</Button>
                                <Button variant="secondary" onClick={() => setEditing(null)}>
                                  Cancel
                                </Button>
                              </div>
                              {error ? <p className="field-error">{error}</p> : null}
                            </form>
                          ) : (
                            <>
                              <Money minor={w.hourlyRateMinor} />
                              <br />
                              <Button
                                variant="link"
                                onClick={() => {
                                  setEditing(w.id);
                                  setRate(minorToMajorString(w.hourlyRateMinor));
                                  setError(null);
                                }}
                              >
                                Edit rate
                              </Button>
                            </>
                          )}
                        </td>
                        <td>
                          <div className="status-toggle-cell">
                            {w.active ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                            <br />
                            <Button variant="link" onClick={() => toggleWorkerActive(w)} className="small">
                              {w.active ? 'Deactivate' : 'Reactivate'}
                            </Button>
                          </div>
                        </td>
                        <td className="small">
                          <Link to={`/admin/shifts?workerId=${w.id}`}>Shifts</Link>
                          <br />
                          <Link to={`/admin/payslips?workerId=${w.id}`}>Payslips</Link>
                          <br />
                          <Link to={`/admin/workers/${w.id}/skills`}>Skills</Link>
                          <br />
                          <Link to={`/admin/alerts?workerId=${w.id}`}>Alerts</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </Async>
      </Card>

      {showAddModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-worker-title">
          <div className="modal-dialog card-glass">
            <div className="modal-header">
              <h2 id="add-worker-title" className="h2">
                Add Frontline Worker
              </h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddModal(false)} aria-label="Close">
                <X className="icon-sm" aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handleAddWorker}>
              <div className="modal-body">
                {addError && <div className="banner banner-danger mb-3">{addError}</div>}
                <div className="field">
                  <label htmlFor="worker-name" className="label">
                    Full Name *
                  </label>
                  <input
                    id="worker-name"
                    type="text"
                    className="input"
                    required
                    placeholder="e.g. Ramesh Gowda"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="worker-phone" className="label">
                    Phone Number (10 digits) *
                  </label>
                  <input
                    id="worker-phone"
                    type="tel"
                    className="input"
                    required
                    pattern="\d{10}"
                    placeholder="e.g. 9876543210"
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                  />
                  <small className="help-text">Used by the worker to sign in via phone OTP or PIN.</small>
                </div>
                <div className="form-grid-2">
                  <div className="field">
                    <label htmlFor="worker-job" className="label">
                      Role / Job Title
                    </label>
                    <input
                      id="worker-job"
                      type="text"
                      className="input"
                      placeholder="e.g. Heavy Equipment Operator"
                      value={addJobTitle}
                      onChange={(e) => setAddJobTitle(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="worker-team" className="label">
                      {industry.teamLabel}
                    </label>
                    <input
                      id="worker-team"
                      type="text"
                      className="input"
                      placeholder="e.g. Crew A"
                      value={addTeam}
                      onChange={(e) => setAddTeam(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-grid-2">
                  <div className="field">
                    <label htmlFor="worker-rate" className="label">
                      Hourly Rate (₹) *
                    </label>
                    <input
                      id="worker-rate"
                      type="text"
                      inputMode="decimal"
                      className="input"
                      required
                      placeholder="75.00"
                      value={addRate}
                      onChange={(e) => setAddRate(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="worker-pin" className="label">
                      Initial PIN (4-6 digits)
                    </label>
                    <input
                      id="worker-pin"
                      type="password"
                      maxLength={6}
                      className="input"
                      placeholder="1234"
                      value={addPin}
                      onChange={(e) => setAddPin(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <Button variant="secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={adding || !addName.trim() || !addPhone.trim()}>
                  {adding ? 'Provisioning...' : 'Provision Worker'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
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
      <Card>
        <Async state={skills}>{(d) => <SkillList skills={d.items} onVerify={verify} />}</Async>
        <p className="muted small">
          Mark an entry as checked only after you have seen evidence (for example the original certificate). FairShift does not contact issuing bodies.
        </p>
      </Card>
      <Card title="Add an employer-checked entry">
        <SkillForm
          endpoint={`/admin/workers/${encodeURIComponent(id)}/skills`}
          onAdded={skills.reload}
          successText="Entry added and marked as checked by employer."
        />
      </Card>
    </Page>
  );
}
