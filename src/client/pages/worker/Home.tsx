import { useI18n } from '../../lib/i18n';
import { useMe } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { Link } from '../../lib/router';
import { formatDateTime } from '../../lib/format';
import type { AlertDTO } from '../../../shared/types';
import { Async, Badge, Card, Page } from '../../components/ui';
import { ShiftCard } from '../../components/ShiftCard';

export function AlertList({ alerts }: { alerts: AlertDTO[] }) {
  const { t, locale } = useI18n();
  const me = useMe();
  return (
    <ul className="list">
      {alerts.map((a) => (
        <li key={a.id}>
          <div className="row">
            <strong>{t(`rule.${a.rule}`)}</strong>
            <Badge tone={a.status === 'open' ? 'warn' : 'neutral'}>{a.status === 'open' ? 'Open' : 'Acknowledged'}</Badge>
          </div>
          <p className="small m-0">{a.details}</p>
          <p className="muted small m-0">{formatDateTime(a.createdAt, me.org.timezone, locale)}</p>
        </li>
      ))}
    </ul>
  );
}

export function WorkerHome() {
  const { t } = useI18n();
  const me = useMe();
  const alerts = useApi<{ items: AlertDTO[] }>('/alerts/mine');

  return (
    <Page title={t('home.hello', { name: me.user.name })}>
      <p className="muted">
        {me.user.jobTitle} · {me.user.team}
      </p>
      <div className="grid">
        <ShiftCard onChange={alerts.reload} />
        <Card title={t('home.quick')}>
          <ul className="list">
            <li>
              <Link to="/worker/reports/new">{t('home.reportHazard')}</Link>
            </li>
            <li>
              <Link to="/worker/payslips">{t('home.seePay')}</Link>
            </li>
            <li>
              <Link to="/worker/attendance">{t('att.history')}</Link>
            </li>
            <li>
              <Link to="/worker/feedback">{t('home.giveFeedback')}</Link>
            </li>
            <li>
              <Link to="/worker/skills">{t('nav.skills')}</Link>
            </li>
          </ul>
        </Card>
      </div>
      <Async state={alerts}>
        {(d) =>
          d.items.length > 0 ? (
            <Card title={t('home.alerts')}>
              <p className="muted small">{t('home.alertsHint')}</p>
              <AlertList alerts={d.items.slice(0, 5)} />
            </Card>
          ) : null
        }
      </Async>
    </Page>
  );
}
