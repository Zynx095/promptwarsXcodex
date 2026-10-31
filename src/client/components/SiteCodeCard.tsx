// Shows the rotating site check-in code for display at the workplace (tablet at the gate,
// or read out at the morning briefing). Refreshes every 30 seconds.
import { useEffect } from 'react';
import { useApi } from '../lib/useApi';
import { useMe } from '../lib/session';
import { formatTime } from '../lib/format';
import type { SiteCodeDTO } from '../../shared/types';
import { Async } from './ui';

export function SiteCodeCard() {
  const me = useMe();
  const code = useApi<SiteCodeDTO>('/admin/site-code');
  const { reload } = code;
  useEffect(() => {
    const t = window.setInterval(reload, 30000);
    return () => window.clearInterval(t);
  }, [reload]);

  return (
    <section className="gate-code on-dark" aria-labelledby="gate-code-title">
      <h2 id="gate-code-title">Site check-in code</h2>
      <p className="gate-code-hint">Show this at the workplace. Workers type it when they check in.</p>
      <Async state={code}>
        {(c) => (
          <>
            <p className="gate-code-digits" aria-label={`Site code ${c.code.split('').join(' ')}`}>
              {c.code}
            </p>
            <p className="gate-code-meta">
              <span className="gate-code-rule">{c.requireSiteCode ? 'Required for check-in' : 'Optional at check-in'}</span>
              <span>Accepted until {formatTime(c.validUntil, me.org.timezone)}. A new code appears every 5 minutes.</span>
            </p>
          </>
        )}
      </Async>
    </section>
  );
}
