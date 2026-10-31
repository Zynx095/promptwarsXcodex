import { useState } from 'react';
import { BadgeCheck, CalendarRange, FileCheck2, PencilLine } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { useMe } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { qs } from '../../lib/api';
import { formatDate, formatMinutes, formatPeriod, formatTime } from '../../lib/format';
import type { ShiftDTO } from '../../../shared/types';
import { Async, Button, Empty, Field, Page } from '../../components/ui';
import { ShiftCard } from '../../components/ShiftCard';
import { ReceiptModal } from '../../components/ReceiptView';

function DateCell({ date, locale }: { date: string; locale: string }) {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(d);
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  return (
    <>
      <span className="st-weekday">{weekday}</span>
      <span className="st-day">{day}</span>
    </>
  );
}

export function WorkerAttendance() {
  const { t, locale } = useI18n();
  const me = useMe();
  const tz = me.org.timezone;
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [rangeOpen, setRangeOpen] = useState(false);
  const [viewingReceiptShiftId, setViewingReceiptShiftId] = useState<string | null>(null);
  const history = useApi<{ range: { from: string; to: string }; items: ShiftDTO[] }>(`/attendance/shifts${qs(range)}`);

  return (
    <Page title={t('att.title')}>
      <ShiftCard onChange={history.reload} />

      <section aria-labelledby="att-history">
        <div className="section-head">
          <h2 id="att-history">{t('att.history')}</h2>
          {history.data ? <span className="section-meta">{formatPeriod(history.data.range.from, history.data.range.to, locale)}</span> : null}
        </div>

        <details className="range-picker" open={rangeOpen} onToggle={(e) => setRangeOpen(e.currentTarget.open)}>
          <summary>
            <CalendarRange className="icon" aria-hidden="true" />
            {t('att.changeDates')}
          </summary>
          <form
            className="form-row"
            onSubmit={(e) => {
              e.preventDefault();
              setRange({ from: draft.from || undefined, to: draft.to || undefined });
              setRangeOpen(false);
            }}
          >
            <Field label={t('common.from')}>
              <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </Field>
            <Field label={t('common.to')}>
              <input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </Field>
            <div className="field">
              <Button type="submit" variant="secondary">
                {t('common.apply')}
              </Button>
            </div>
          </form>
        </details>

        <Async state={history}>
          {(d) => {
            if (d.items.length === 0) return <Empty>{t('att.noShifts')}</Empty>;
            const total = d.items.reduce((n, s) => n + (s.durationMinutes ?? 0), 0);
            return (
              <>
                <p className="att-summary">{t('att.summary', { count: d.items.length, hours: formatMinutes(total) })}</p>
                <div className="table-wrap">
                  <table className="shift-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('att.date')}</th>
                        <th scope="col">
                          {t('att.in')} – {t('att.out')}
                        </th>
                        <th scope="col" className="num">
                          {t('att.hours')}
                        </th>
                        <th scope="col">
                          <span className="visually-hidden">{t('receipt.view')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((s) => (
                        <tr key={s.id} className={s.checkOutAt ? undefined : 'is-open'}>
                          <td className="st-date">
                            <DateCell date={s.localDate} locale={locale} />
                          </td>
                          <td className="st-time">
                            <span className="st-span figure">
                              {formatTime(s.checkInAt, tz, locale)} – {s.checkOutAt ? formatTime(s.checkOutAt, tz, locale) : '…'}
                            </span>
                            <span className="st-tags">
                              {s.checkOutAt ? null : <span className="badge badge-good">{t('att.open')}</span>}
                              {s.corrected ? (
                                <span className="badge badge-warn">
                                  <PencilLine className="icon-xs" aria-hidden="true" />
                                  {t('att.corrected')}
                                </span>
                              ) : null}
                              {s.checkInMethod === 'site_code' ? (
                                <span className="st-site">
                                  <BadgeCheck className="icon-xs" aria-hidden="true" />
                                  {t('site.verified')}
                                </span>
                              ) : s.checkInMethod === 'site_qr' ? (
                                <span className="st-site">
                                  <BadgeCheck className="icon-xs" aria-hidden="true" />
                                  {t('qr.methodLabel', { site: s.siteName ?? '' })}
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="num st-hours">{s.durationMinutes !== null ? formatMinutes(s.durationMinutes) : '—'}</td>
                          <td className="st-receipt">
                            {s.checkOutAt ? (
                              <button
                                type="button"
                                className="btn btn-quiet btn-sm"
                                onClick={() => setViewingReceiptShiftId(s.id)}
                                aria-label={`${t('receipt.view')}: ${formatDate(s.localDate, locale)}`}
                              >
                                <FileCheck2 className="icon-sm" aria-hidden="true" />
                                {t('receipt.view')}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          }}
        </Async>
      </section>
      {viewingReceiptShiftId ? <ReceiptModal shiftId={viewingReceiptShiftId} onClose={() => setViewingReceiptShiftId(null)} /> : null}
    </Page>
  );
}
