// Notification centre: the bell shows the unread count; the sheet lists updates newest first,
// split into new and earlier, each with its kind, time and a link to the record it is about.
import { useState } from 'react';
import { Bell, BellOff, CheckCheck, Clock, IndianRupee, ShieldAlert, ShieldCheck, Info, ChevronRight } from 'lucide-react';
import { useNotifications } from '../lib/notifications';
import { useRouter } from '../lib/router';
import { useI18n } from '../lib/i18n';
import { useMe } from '../lib/session';
import { formatDateTime } from '../lib/format';
import type { NotificationDTO } from '../../shared/types';
import { Sheet } from './Sheet';

const KIND: Record<string, { icon: typeof Bell; tone: string }> = {
  safety_alert: { icon: ShieldAlert, tone: 'tone-danger' },
  safety_update: { icon: ShieldCheck, tone: 'tone-info' },
  payslip_issued: { icon: IndianRupee, tone: 'tone-good' },
  shift_correction: { icon: Clock, tone: 'tone-caution' },
};

function useRelativeTime() {
  const { locale } = useI18n();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  return (iso: string) => {
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 60) return rtf.format(0, 'minute');
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
    return rtf.format(Math.round(seconds / 86400), 'day');
  };
}

export function NotificationBell() {
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const { navigate } = useRouter();
  const { t, locale } = useI18n();
  const me = useMe();
  const relative = useRelativeTime();
  const unread = items.filter((n) => !n.read);
  const earlier = items.filter((n) => n.read).slice(0, 20);

  async function openItem(item: NotificationDTO) {
    if (!item.read) await markRead(item.id).catch(() => undefined);
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  const renderItem = (item: NotificationDTO) => {
    const kind = KIND[item.type] ?? { icon: Info, tone: '' };
    return (
      <li key={item.id}>
        <button type="button" className={`notif-item${item.read ? '' : ' is-unread'}`} onClick={() => void openItem(item)}>
          <span className={`row-icon ${kind.tone}`} aria-hidden="true">
            <kind.icon className="icon" />
          </span>
          <span className="notif-text">
            {item.type === 'safety_alert' ? <span className="notif-kind">{t('notifications.safetyAlert')}</span> : null}
            <strong>{item.title}</strong>
            <span className="notif-body">{item.body}</span>
            <time className="notif-time" dateTime={item.createdAt} title={formatDateTime(item.createdAt, me.org.timezone, locale)}>
              {relative(item.createdAt)}
            </time>
          </span>
          {item.read ? null : <span className="visually-hidden">{t('notifications.unread')}</span>}
          {item.link ? <ChevronRight className="icon chevron" aria-hidden="true" /> : null}
        </button>
      </li>
    );
  };

  return (
    <>
      <button
        type="button"
        className="bell"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? t('notifications.labelUnread', { count: unreadCount }) : t('notifications.title')}
      >
        <Bell className="icon" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="bell-count" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('notifications.title')} className="notif-sheet">
        {unreadCount > 0 ? (
          <div className="notif-actions">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void markAllRead().catch(() => undefined)}>
              <CheckCheck className="icon-sm" aria-hidden="true" />
              {t('notifications.markAllRead')}
            </button>
          </div>
        ) : null}
        {items.length === 0 ? (
          <div className="notif-empty">
            <BellOff className="icon" aria-hidden="true" />
            <p className="m-0">
              <strong>{t('notifications.empty')}</strong>
            </p>
            <p className="m-0">{t('notifications.emptyHint')}</p>
          </div>
        ) : (
          <>
            {unread.length > 0 ? (
              <section aria-labelledby="notice-new">
                <h3 id="notice-new" className="notif-group">
                  {t('notifications.new')}
                </h3>
                <ul className="notif-list">{unread.map(renderItem)}</ul>
              </section>
            ) : null}
            {earlier.length > 0 ? (
              <section aria-labelledby="notice-earlier">
                <h3 id="notice-earlier" className="notif-group">
                  {t('notifications.earlier')}
                </h3>
                <ul className="notif-list">{earlier.map(renderItem)}</ul>
              </section>
            ) : null}
          </>
        )}
      </Sheet>
    </>
  );
}
