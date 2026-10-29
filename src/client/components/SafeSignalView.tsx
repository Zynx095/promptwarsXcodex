import { useState } from 'react';
import { Activity, ChevronDown, ChevronUp, Filter, ShieldCheck } from 'lucide-react';
import { useApi } from '../lib/useApi';
import type { SafeSignalResponse, SafeSignalDTO, Severity } from '../../shared/types';
import { Badge, Button, Card, Loading, SeverityBadge } from './ui';

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
    <Card className="safe-signal-card mb-4">
      <div className="flex justify-between items-center flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Activity className="icon text-aubergine" aria-hidden="true" style={{ color: 'var(--c-aubergine)' }} />
          <h2 className="card-title text-base m-0" style={{ margin: 0 }}>
            Safe Signal — Hazard Pattern Detection
          </h2>
          <span className="badge badge-info" title="Zero reporter identifiers queried or exposed">
            <ShieldCheck className="icon mr-1" aria-hidden="true" style={{ width: 14, height: 14, verticalAlign: 'middle', display: 'inline' }} />
            Privacy Protected (Cohort ≥ {cohortThreshold})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">
            {signals.length} {signals.length === 1 ? 'pattern' : 'patterns'} detected across {analyzedReportCount} reports
          </span>
          <Button
            variant="secondary"
            className="btn-sm py-1 px-2 text-xs"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand Safe Signals' : 'Collapse Safe Signals'}
          >
            {collapsed ? <ChevronDown className="icon" aria-hidden="true" /> : <ChevronUp className="icon" aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <>
          <p className="text-xs text-muted mb-3">
            Safe Signal automatically analyzes recurring hazard clusters while protecting worker confidentiality. Clusters are only surfaced when at least{' '}
            {cohortThreshold} distinct reports exist, preventing individual re-identification.
          </p>

          {signals.length === 0 ? (
            <div
              className="p-3 rounded border text-xs text-muted flex items-center gap-2"
              style={{ background: 'rgba(58, 15, 52, 0.02)', borderColor: 'rgba(58, 15, 52, 0.08)' }}
            >
              <ShieldCheck className="icon text-good" aria-hidden="true" style={{ color: 'var(--c-good)' }} />
              <span>No recurring hazard patterns detected. Reports are currently distributed within expected variance or below cohort threshold.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {signals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} onSelectCategory={onSelectCategory} />
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function SignalCard({ signal, onSelectCategory }: { signal: SafeSignalDTO; onSelectCategory?: (category: string) => void }) {
  const isRecurrent = signal.confidence === 'recurrent_hazard';

  return (
    <div
      className="p-3 rounded border"
      style={{
        background: isRecurrent ? 'rgba(197, 48, 48, 0.04)' : 'rgba(234, 170, 0, 0.04)',
        borderColor: isRecurrent ? 'rgba(197, 48, 48, 0.25)' : 'rgba(234, 170, 0, 0.3)',
      }}
    >
      <div className="flex justify-between items-start flex-wrap gap-2 mb-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm" style={{ color: 'var(--c-heading)' }}>
              {signal.title}
            </span>
            <SeverityBadge severity={signal.severityLevel} />
            <Badge tone={isRecurrent ? 'bad' : 'warn'}>{isRecurrent ? 'Recurrent Hazard' : 'Possible Pattern'}</Badge>
            <Badge tone="neutral">{signal.timeWindow}</Badge>
          </div>
          <span className="text-xs text-muted block mt-1">
            Category: <strong>{signal.categoryLabel}</strong> · {signal.reportCount} reports ({signal.statusSummary.unresolvedCount} unresolved,{' '}
            {signal.statusSummary.resolvedCount} resolved)
          </span>
        </div>

        {onSelectCategory && (
          <Button variant="secondary" className="btn-sm text-xs flex items-center gap-1" onClick={() => onSelectCategory(signal.category)}>
            <Filter className="icon" style={{ width: 12, height: 12 }} aria-hidden="true" />
            Filter Queue
          </Button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap mb-2 text-xs">
        <span className="text-muted">Severity distribution:</span>
        {(Object.entries(signal.severityDistribution) as [Severity, number][]).map(([sev, count]) =>
          count > 0 ? (
            <span key={sev} className="text-xs font-semibold px-1 rounded" style={{ background: 'rgba(58, 15, 52, 0.06)' }}>
              {sev}: {count}
            </span>
          ) : null,
        )}
      </div>

      <div className="mt-2 pt-2 border-t" style={{ borderColor: 'rgba(58, 15, 52, 0.08)' }}>
        <span className="text-xs font-bold block mb-1" style={{ color: 'var(--c-heading)' }}>
          Recommended Proactive Actions:
        </span>
        <ul className="text-xs list-disc pl-4 m-0" style={{ margin: 0, paddingLeft: '1.2rem' }}>
          {signal.recommendedActions.map((action, i) => (
            <li key={i} className="text-muted mb-0.5">
              {action}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
