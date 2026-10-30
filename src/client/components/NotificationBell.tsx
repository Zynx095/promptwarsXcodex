import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Clock, ShieldAlert, Wallet, Info, ExternalLink } from 'lucide-react';
import { useNotifications } from '../lib/notifications';
import { useRouter } from '../lib/router';
import { useI18n } from '../lib/i18n';
import type { NotificationDTO } from '../../shared/types';

function relativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  } catch {
    return iso.slice(0, 10);
  }
}

function getIcon(type: NotificationDTO['type']) {
  switch (type) {
    case 'shift_correction':
      return <Clock className="notif-type-icon text-marigold" aria-hidden="true" />;
    case 'payslip_issued':
      return <Wallet className="notif-type-icon text-success" aria-hidden="true" />;
    case 'safety_alert':
    case 'safety_update':
      return <ShieldAlert className="notif-type-icon text-danger" aria-hidden="true" />;
    default:
      return <Info className="notif-type-icon text-muted" aria-hidden="true" />;
  }
}

export function NotificationBell() {
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { navigate } = useRouter();
  const { t } = useI18n();

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleItemClick(item: NotificationDTO) {
    if (!item.read) await markRead(item.id).catch(() => undefined);
    setOpen(false);
    if (item.link) navigate(item.link);
  }

  async function handleMarkAllRead() {
    await markAllRead().catch(() => undefined);
  }

  return (
    <div className="notif-wrapper" ref={dropdownRef}>
      <button
        type="button"
        className="btn btn-secondary notif-bell-btn"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t('notifications.title') || 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell className="icon" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="notif-badge" aria-label={`${unreadCount} unread`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown" role="dialog" aria-label="Notifications list">
          <div className="notif-header">
            <div className="notif-header-title">
              <strong>{t('notifications.title') || 'Notifications'}</strong>
              {unreadCount > 0 && <span className="notif-pill">{unreadCount} new</span>}
            </div>
            {unreadCount > 0 && (
              <button type="button" className="btn btn-secondary btn-sm notif-mark-all" onClick={handleMarkAllRead}>
                <CheckCheck className="icon-sm" aria-hidden="true" />
                <span>{t('notifications.markAllRead') || 'Mark all read'}</span>
              </button>
            )}
          </div>

          <div className="notif-body">
            {items.length === 0 ? (
              <div className="notif-empty">
                <p>{t('notifications.empty') || 'No notifications yet.'}</p>
              </div>
            ) : (
              <ul className="notif-list">
                {items.slice(0, 15).map((item) => (
                  <li key={item.id}>
                    <button type="button" className={`notif-item ${item.read ? 'read' : 'unread'}`} onClick={() => handleItemClick(item)}>
                      <div className="notif-item-icon">{getIcon(item.type)}</div>
                      <div className="notif-item-content">
                        <div className="notif-item-head">
                          <span className="notif-item-title">{item.title}</span>
                          <span className="notif-item-time">{relativeTime(item.createdAt)}</span>
                        </div>
                        <p className="notif-item-body">{item.body}</p>
                        {item.link && (
                          <span className="notif-item-link-hint">
                            <span>View</span>
                            <ExternalLink className="icon-xs" aria-hidden="true" />
                          </span>
                        )}
                      </div>
                      {!item.read && <span className="notif-unread-dot" aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
