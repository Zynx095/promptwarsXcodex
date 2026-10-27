import { useState } from 'react';
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

export function AdminWorkers() {
  const me = useMe();
  const { t } = useI18n();
  const workers = useApi<{ items: WorkerDTO[] }>('/admin/workers');
  const [editing, setEditing] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const industry = getIndustry(me.org.industry);

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
    <Page title="Workforce">
      {saved ? <Notice kind="success">{saved}</Notice> : null}
      <Card>
        <Async state={workers}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>No workers in this organisation.</Empty>
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
                      <th scope="col">Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((w) => (
                      <tr key={w.id}>
                        <td>
                          <strong>{w.name}</strong>
                          <br />
                          <span className="muted small">
                            {w.jobTitle} · {w.phone}
                          </span>
                          {!w.active ? (
                            <>
                              {' '}
                              <Badge tone="neutral">Inactive</Badge>
                            </>
                          ) : null}
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
                              <input id={`rate-${w.id}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} style={{ maxWidth: 120 }} />
                              <div className="form-actions" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
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
            )
          }
        </Async>
      </Card>
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
