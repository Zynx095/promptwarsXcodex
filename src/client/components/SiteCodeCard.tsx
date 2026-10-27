// Shows the rotating site check-in code for display at the workplace (tablet at the gate,
// or read out at the morning briefing). Refreshes every 30 seconds.
import { useEffect } from 'react';
import { KeyRound } from 'lucide-react';
import { useApi } from '../lib/useApi';
import { useMe } from '../lib/session';
import { formatTime } from '../lib/format';
import type { SiteCodeDTO } from '../../shared/types';
import { Async, Badge, Card } from './ui';

export function SiteCodeCard() {
  const me = useMe();
  const code = useApi<SiteCodeDTO>('/admin/site-code');
  const { reload } = code;
  useEffect(() => {
    const t = window.setInterval(reload, 30000);
    return () => window.clearInterval(t);
  }, [reload]);

  return (
    <Card title="Site check-in code" subtitle="Show this at the workplace. Workers can type it when they check in.">
      <Async state={code}>
        {(c) => (
          <div className="row">
            <div>
              <p className="site-code" aria-label={`Site code ${c.code.split('').join(' ')}`}>
                <KeyRound className="icon" aria-hidden="true" style={{ width: 26, height: 26, marginRight: 10, verticalAlign: -2, color: 'var(--c-accent)' }} />
                {c.code}
              </p>
              <p className="muted small" style={{ margin: 0 }}>
                Accepted until {formatTime(c.validUntil, me.org.timezone)}. A new code appears every 5 minutes.
              </p>
            </div>
            <Badge tone={c.requireSiteCode ? 'info' : 'neutral'}>{c.requireSiteCode ? 'Required for check-in' : 'Optional'}</Badge>
          </div>
        )}
      </Async>
    </Card>
  );
}
