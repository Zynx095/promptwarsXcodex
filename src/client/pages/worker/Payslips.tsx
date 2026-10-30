import { useI18n } from '../../lib/i18n';
import { useApi } from '../../lib/useApi';
import { Link, useRouter } from '../../lib/router';
import { formatDate } from '../../lib/format';
import type { Paged, PayslipDTO, PayslipListItem } from '../../../shared/types';
import { Async, Card, Empty, Money, Page } from '../../components/ui';
import { PayslipBreakdown } from '../../components/PayslipBreakdown';
import { MoneyJar } from '../../components/MoneyJar';
import { Printer } from 'lucide-react';

export function WorkerPayslips() {
  const { t, locale } = useI18n();
  const preview = useApi<PayslipDTO>('/payslips/preview');
  const issued = useApi<Paged<PayslipListItem>>('/payslips?limit=50');

  return (
    <Page title={t('pay.title')}>
      <Card title={t('pay.issued')}>
        <Async state={issued}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>{t('pay.none')}</Empty>
            ) : (
              <ul className="list">
                {d.items.map((p) => (
                  <li key={p.id} className="row">
                    <span>
                      <Link to={`/worker/payslips/${p.id}`}>
                        {formatDate(p.periodStart, locale)} – {formatDate(p.periodEnd, locale)}
                      </Link>
                    </span>
                    <span>
                      {t('pay.net')}:{' '}
                      <strong>
                        <Money minor={p.netPayMinor} />
                      </strong>
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </Card>
      <Card title={t('pay.current')}>
        <p className="muted small">{t('pay.currentHint')}</p>
        <Async state={preview}>
          {(slip) => (
            <>
              <MoneyJar slip={slip} />
              <PayslipBreakdown slip={slip} />
            </>
          )}
        </Async>
      </Card>
    </Page>
  );
}

export function WorkerPayslipView({ id }: { id: string }) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const slip = useApi<PayslipDTO>(`/payslips/${encodeURIComponent(id)}`);
  return (
    <Page
      title={t('pay.title')}
      actions={
        <div className="btn-group">
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            <Printer className="icon-sm" aria-hidden="true" />
            <span>{t('pay.print') || 'Print'}</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/worker/payslips')}>
            {t('action.back')}
          </button>
        </div>
      }
    >
      <Card>
        <Async state={slip}>
          {(s) => (
            <>
              <MoneyJar slip={s} />
              <PayslipBreakdown slip={s} />
            </>
          )}
        </Async>
      </Card>
    </Page>
  );
}
