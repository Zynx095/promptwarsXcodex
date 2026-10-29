import { useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { useMe } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { qs } from '../../lib/api';
import { formatDate, formatMinutes, formatTime } from '../../lib/format';
import type { ShiftDTO } from '../../../shared/types';
import { Async, Badge, Button, Card, Empty, Field, Page } from '../../components/ui';
import { ShiftCard } from '../../components/ShiftCard';
import { ReceiptModal } from '../../components/ReceiptView';

export function WorkerAttendance() {
  const { t, locale } = useI18n();
  const me = useMe();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [viewingReceiptShiftId, setViewingReceiptShiftId] = useState<string | null>(null);
  const history = useApi<{ range: { from: string; to: string }; items: ShiftDTO[] }>(`/attendance/shifts${qs(range)}`);

  return (
    <Page title={t('att.title')}>
      <ShiftCard onChange={history.reload} />
      <Card title={t('att.history')}>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            setRange({ from: draft.from || undefined, to: draft.to || undefined });
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
        <Async state={history}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>{t('att.noShifts')}</Empty>
            ) : (
              <>
                <p className="muted small">
                  {formatDate(d.range.from, locale)} – {formatDate(d.range.to, locale)}
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t('att.date')}</th>
                        <th scope="col">{t('att.in')}</th>
                        <th scope="col">{t('att.out')}</th>
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
                        <tr key={s.id}>
                          <td>
                            {formatDate(s.localDate, locale)}
                            {s.corrected ? (
                              <>
                                <br />
                                <Badge tone="info">{t('att.corrected')}</Badge>
                              </>
                            ) : null}
                          </td>
                          <td>{formatTime(s.checkInAt, me.org.timezone, locale)}</td>
                          <td>{s.checkOutAt ? formatTime(s.checkOutAt, me.org.timezone, locale) : <Badge tone="good">{t('att.open')}</Badge>}</td>
                          <td className="num">{s.durationMinutes !== null ? formatMinutes(s.durationMinutes) : '—'}</td>
                          <td>
                            {s.checkOutAt ? (
                              <Button
                                variant="link"
                                onClick={() => setViewingReceiptShiftId(s.id)}
                                aria-label={`${t('receipt.view')} ${formatDate(s.localDate, locale)}`}
                              >
                                {t('receipt.view')}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          }
        </Async>
      </Card>
      {viewingReceiptShiftId ? <ReceiptModal shiftId={viewingReceiptShiftId} onClose={() => setViewingReceiptShiftId(null)} /> : null}
    </Page>
  );
}
