// Safe Signal for administrators: groups of hazard reports of the same kind, shown only when enough
// separate reports exist. It shows counts, never who reported; the copy says what the threshold
// does and does not protect.
import { useState } from 'react';
import { Activity, ListFilter } from 'lucide-react';
import { useApi } from '../lib/useApi';
import type { SafeSignalResponse, SafeSignalDTO, Severity } from '../../shared/types';
import { Badge, Button, Loading, SeverityBadge } from './ui';

export function SafeSignalView({ onSelectCategory }: { onSelectCategory?: (category: string) => void }) {
  const signalState = useApi<SafeSignalResponse>('/admin/signals');
  const [collapsed, setCollapsed] = useState(false);

  if (signalState.loading && !signalState.data) {
    return <Loading />;
  }

  if (signalState.error) {
    return null; // Silent degradation if signals fail to load
  }

  const { signals = [], cohortThreshold = 3, analyzedReportCount = 0 } = signalState.data ?? {};

  return (
    <section className="signal" aria-labelledby="signal-title">
      <div className="signal-head">
        <h2 id="signal-title">
          <Activity className="icon" aria-hidden="true" />
          Safe Signal: repeated hazards
        </h2>
        <p className="signal-count">
          {signals.length} {signals.length === 1 ? 'pattern' : 'patterns'} in {analyzedReportCount} reports
        </p>
        <Button
          variant="quiet"
          className="btn btn-quiet btn-sm"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls="signal-body"
        >
          {collapsed ? 'Show' : 'Hide'}
        </Button>
      </div>

      {!collapsed && (
        <div id="signal-body">
          <p className="signal-note">
            A pattern appears only when at least {cohortThreshold} separate reports describe the same kind of hazard. Patterns show counts, never who reported.
            The threshold makes a single report harder to trace to a person; it does not make that impossible, so treat details with care.
          </p>

          {signals.length === 0 ? (
            <p className="signal-empty">No repeated hazards right now. Either reports differ, or too few share a hazard type to show a pattern.</p>
          ) : (
            <ul className="signal-list">
              {signals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} onSelectCategory={onSelectCategory} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function SignalCard({ signal, onSelectCategory }: { signal: SafeSignalDTO; onSelectCategory?: (category: string) => void }) {
  const isRecurrent = signal.confidence === 'recurrent_hazard';
  const severities = (Object.entries(signal.severityDistribution) as [Severity, number][]).filter(([, count]) => count > 0);

  return (
    <li className={`signal-card${isRecurrent ? ' is-recurrent' : ''}`}>
      <div className="signal-card-head">
        <p className="signal-card-title">{signal.title}</p>
        <div className="signal-card-tags">
          <SeverityBadge severity={signal.severityLevel} />
          <Badge tone={isRecurrent ? 'bad' : 'warn'}>{isRecurrent ? 'Recurring hazard' : 'Possible pattern'}</Badge>
          <Badge tone="neutral">{signal.timeWindow}</Badge>
        </div>
      </div>
      <p className="signal-card-meta">
        {signal.categoryLabel}: {signal.reportCount} reports, {signal.statusSummary.unresolvedCount} unresolved and {signal.statusSummary.resolvedCount}{' '}
        resolved.
        {severities.length ? <> By severity: {severities.map(([sev, count]) => `${sev} ${count}`).join(', ')}.</> : null}
      </p>
      <p className="signal-card-sub">Suggested next steps</p>
      <ul className="signal-actions">
        {signal.recommendedActions.map((action, i) => (
          <li key={i}>{action}</li>
        ))}
      </ul>
      {onSelectCategory ? (
        <Button variant="secondary" className="btn btn-secondary btn-sm" onClick={() => onSelectCategory(signal.category)}>
          <ListFilter className="icon-sm" aria-hidden="true" />
          <span>Show these reports</span>
        </Button>
      ) : null}
    </li>
  );
}
