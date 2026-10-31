import { useState } from 'react';
import { ChevronRight, FileText, FileWarning, Printer } from 'lucide-react';
import { useI18n, useMoney } from '../../lib/i18n';
import { useApi } from '../../lib/useApi';
import { Link } from '../../lib/router';
import { formatDate, formatPeriod } from '../../lib/format';
import type { Paged, PayslipDTO, PayslipListItem } from '../../../shared/types';
import { Async, Empty, Page } from '../../components/ui';
import { PayslipBreakdown } from '../../components/PayslipBreakdown';
import { MoneyJar } from '../../components/MoneyJar';
import { DisputeNoticeModal } from '../../components/DisputeNoticeModal';
import { PayCheckCard, payPeriodOptions } from '../../components/PayCheck';
import { useMe } from '../../lib/session';
import { localDate } from '../../../shared/time';

export function WorkerPayslips() {
  const { t, locale } = useI18n();
  const me = useMe();
  const money = useMoney();
  const preview = useApi<PayslipDTO>('/payslips/preview');
  const issued = useApi<Paged<PayslipListItem>>('/payslips?limit=50');
  const options = issued.data ? payPeriodOptions(localDate(new Date(), me.org.timezone), issued.data.items, t, locale) : null;

  return (
    <Page title={t('pay.title')}>
      <Async state={preview}>{(slip) => <MoneyJar slip={slip} />}</Async>

      {options ? <PayCheckCard key={options.map((o) => o.key).join('|')} options={options} /> : null}

      <section aria-labelledby="pay-issued">
        <div className="section-head">
          <h2 id="pay-issued">{t('pay.issued')}</h2>
        </div>
        <Async state={issued}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>{t('pay.none')}</Empty>
            ) : (
              <ul className="row-list">
                {d.items.map((p) => (
                  <li key={p.id}>
                    <Link to={`/worker/payslips/${p.id}`} className="row-item">
                      <span className="row-icon" aria-hidden="true">
                        <FileText className="icon" />
                      </span>
                      <span className="row-text">
                        <strong>{formatPeriod(p.periodStart, p.periodEnd, locale)}</strong>
                        <span>{t('pay.issuedOn', { date: formatDate(p.issuedAt.slice(0, 10), locale) })}</span>
                      </span>
                      <span className="row-figure figure">
                        <span className="visually-hidden">{t('pay.net')}: </span>
                        {money(p.netPayMinor)}
                      </span>
                      <ChevronRight className="icon chevron" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </section>

      <section className="pay-calculation" aria-labelledby="pay-calc">
        <details>
          <summary>
            <span id="pay-calc">{t('pay.weekCalculation')}</span>
          </summary>
          <Async state={preview}>{(slip) => <PayslipBreakdown slip={slip} />}</Async>
        </details>
      </section>
    </Page>
  );
}

export function WorkerPayslipView({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const slip = useApi<PayslipDTO>(`/payslips/${encodeURIComponent(id)}`);
  const [showDispute, setShowDispute] = useState(false);

  return (
    <Page
      title={t('pay.payslipTitle')}
      actions={
        <div className="btn-group">
          <Link to="/worker/payslips" className="btn btn-quiet">
            {t('action.back')}
          </Link>
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            <Printer className="icon" aria-hidden="true" />
            <span>{t('pay.print')}</span>
          </button>
          {slip.data ? (
            <button type="button" className="btn btn-secondary" onClick={() => setShowDispute(true)}>
              <FileWarning className="icon" aria-hidden="true" />
              <span>{t('dispute.raiseNotice')}</span>
            </button>
          ) : null}
        </div>
      }
    >
      <Async state={slip}>
        {(s) => (
          <>
            <MoneyJar slip={s} />
            <PayCheckCard options={[{ key: 'slip', label: formatPeriod(s.periodStart, s.periodEnd, locale), from: s.periodStart, to: s.periodEnd }]} />
            <PayslipBreakdown slip={s} />
            {showDispute ? <DisputeNoticeModal slip={s} isOpen={showDispute} onClose={() => setShowDispute(false)} /> : null}
          </>
        )}
      </Async>
    </Page>
  );
}
