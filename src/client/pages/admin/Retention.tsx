// Retention attention panel: a fixed, visible set of rules over recorded data that points the
// employer at administrative issues to fix (long hours, unresolved reports, pay gaps, disputed
// records). Every level comes with its reasons, the records behind them and suggested follow-up.
// It is not a prediction about anyone and must never be used against a worker.
import { useMemo, useState } from 'react';
import { ChevronRight, Info, UserRoundSearch } from 'lucide-react';
import { useApi } from '../../lib/useApi';
import { Link } from '../../lib/router';
import { useMe } from '../../lib/session';
import { formatDate, formatDateTime } from '../../lib/format';
import type { AttentionLevel, RetentionPanelDTO, RetentionWorkerDTO } from '../../../shared/types';
import { Async, Badge, Empty, Field, Notice, Page } from '../../components/ui';
import { Sheet } from '../../components/Sheet';

const LEVEL: Record<AttentionLevel, { label: string; tone: 'good' | 'warn' | 'bad'; rank: number }> = {
  high: { label: 'High attention', tone: 'bad', rank: 3 },
  moderate: { label: 'Moderate attention', tone: 'warn', rank: 2 },
  low: { label: 'Low attention', tone: 'good', rank: 1 },
};

type Sort = 'attention' | 'name';
type LevelFilter = 'all' | AttentionLevel;

function WorkerDetail({ worker, panel }: { worker: RetentionWorkerDTO; panel: RetentionPanelDTO }) {
  const me = useMe();
  const l = LEVEL[worker.level];
  return (
    <div className="retention-detail">
      <p className="retention-detail-head">
        <Badge tone={l.tone}>{l.label}</Badge>
        <span className="muted small">
          Score {worker.score} (moderate from {panel.thresholds.moderate}, high from {panel.thresholds.high})
        </span>
      </p>
      {worker.factors.length === 0 ? (
        <Notice kind="success">No attention rule was triggered for {worker.name} in this period.</Notice>
      ) : (
        <ol className="retention-factors">
          {worker.factors.map((f) => (
            <li key={f.key} className="retention-factor">
              <div className="retention-factor-head">
                <strong>{f.label}</strong>
                <span className="figure muted small">
                  +{f.points} of {f.maxPoints}
                </span>
              </div>
              <p className="m-0">{f.reason}</p>
              <details>
                <summary>Records behind this ({f.records.length})</summary>
                <ul className="retention-records">
                  {f.records.map((r, i) => (
                    <li key={`${r.at}-${i}`}>
                      {r.at ? <span className="muted small">{r.at.length > 10 ? formatDateTime(r.at, me.org.timezone) : formatDate(r.at)}</span> : null}
                      {r.link ? <Link to={r.link}>{r.label}</Link> : <span>{r.label}</span>}
                    </li>
                  ))}
                </ul>
              </details>
              <p className="retention-followup">
                <span className="retention-followup-label">Suggested follow-up</span> {f.followUp}
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">{panel.disclaimer}</p>
    </div>
  );
}

export function AdminRetention() {
  const panel = useApi<RetentionPanelDTO>('/admin/retention');
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [sort, setSort] = useState<Sort>('attention');
  const [open, setOpen] = useState<RetentionWorkerDTO | null>(null);

  const rows = useMemo(() => {
    const items = panel.data?.workers ?? [];
    const q = query.trim().toLowerCase();
    return items
      .filter((w) => level === 'all' || w.level === level)
      .filter((w) => !q || [w.name, w.jobTitle, w.team].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) =>
        sort === 'name' ? a.name.localeCompare(b.name) : LEVEL[b.level].rank - LEVEL[a.level].rank || b.score - a.score || a.name.localeCompare(b.name),
      );
  }, [panel.data, query, level, sort]);

  return (
    <Page
      title="Retention attention"
      description="Administrative issues that may need attention, found by fixed rules over recorded hours, alerts, safety reports and pay. It is not a prediction of whether anyone will leave."
    >
      <Async state={panel}>
        {(d) => (
          <>
            <div className="attention-tiles" role="group" aria-label="Workers by attention level">
              {(['high', 'moderate', 'low'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`attention-tile tone-${LEVEL[k].tone}`}
                  aria-pressed={level === k}
                  onClick={() => setLevel(level === k ? 'all' : k)}
                >
                  <span className="attention-tile-label">{LEVEL[k].label}</span>
                  <span className="attention-tile-value figure">{d.counts[k]}</span>
                </button>
              ))}
            </div>
            <p className="muted small">
              Last {d.window.days} days ({formatDate(d.window.from)} to {formatDate(d.window.to)}). Active workers only. Confidential safety reports and
              anonymous feedback are never attributed to anyone.
            </p>

            <div className="table-tools">
              <Field label="Search workers">
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, job or team" />
              </Field>
              <Field label="Attention level">
                <select value={level} onChange={(e) => setLevel(e.target.value as LevelFilter)}>
                  <option value="all">All levels</option>
                  <option value="high">High</option>
                  <option value="moderate">Moderate</option>
                  <option value="low">Low</option>
                </select>
              </Field>
              <Field label="Sort by">
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="attention">Attention level</option>
                  <option value="name">Name</option>
                </select>
              </Field>
            </div>

            {rows.length === 0 ? (
              <Empty>No workers match these filters.</Empty>
            ) : (
              <ul className="row-list retention-list">
                {rows.map((w) => (
                  <li key={w.workerId}>
                    <button type="button" className="row-item" aria-haspopup="dialog" onClick={() => setOpen(w)}>
                      <span className={`row-icon tone-${w.level === 'high' ? 'danger' : w.level === 'moderate' ? 'caution' : 'good'}`} aria-hidden="true">
                        <UserRoundSearch className="icon" />
                      </span>
                      <span className="row-text">
                        <strong>{w.name}</strong>
                        <span>{[w.jobTitle, w.team].filter(Boolean).join(', ')}</span>
                        <span className="row-meta">{w.factors.length ? w.factors.map((f) => f.label).join(' · ') : 'No rule triggered'}</span>
                      </span>
                      <Badge tone={LEVEL[w.level].tone}>{LEVEL[w.level].label}</Badge>
                      <ChevronRight className="icon chevron" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <section className="card retention-rules" aria-labelledby="retention-rules">
              <h2 id="retention-rules" className="card-title">
                <Info className="icon" aria-hidden="true" /> How the levels are worked out
              </h2>
              <ul>
                <li>Overtime days in the window: 3 or more = 1 point, 6 or more = 2.</li>
                <li>Open (unacknowledged) hours alerts: 1 = 1 point, 2 or more = 2.</li>
                <li>Shift records corrected or left open over 16 hours: 1 = 1 point, 3 or more = 2.</li>
                <li>Named safety reports still unresolved, plus fixes the worker disputed: 1 = 1 point, 2 or more = 2.</li>
                <li>Issued pay periods with a recorded pay gap: possible shortfall = 1 point, requires review = 2.</li>
                <li>
                  Total {d.thresholds.moderate}–{d.thresholds.high - 1} = moderate, {d.thresholds.high} or more = high.
                </li>
              </ul>
              {d.unavailable.length ? (
                <>
                  <h3 className="retention-subhead">Not included</h3>
                  <ul>
                    {d.unavailable.map((u) => (
                      <li key={u.key}>{u.reason}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="muted small m-0">{d.disclaimer}</p>
            </section>

            <Sheet
              open={open !== null}
              onClose={() => setOpen(null)}
              title={open ? `${open.name}: retention attention` : 'Retention attention'}
              className="retention-sheet"
            >
              {open ? <WorkerDetail worker={open} panel={d} /> : null}
            </Sheet>
          </>
        )}
      </Async>
    </Page>
  );
}
