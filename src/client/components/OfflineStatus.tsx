// Offline status for workers: a banner when the phone is offline or has unsent items, and the
// list of what is saved on this phone with its state (waiting, sending, recorded, needs you,
// not sent). Saved check-ins say "pending verification" until the server confirms them.
import { useState } from 'react';
import { CircleAlert, CircleCheck, CloudOff, KeyRound, LoaderCircle, LogIn, RefreshCw, ShieldAlert, Trash2, CloudUpload } from 'lucide-react';
import { useI18n, type MessageKey } from '../lib/i18n';
import { useOnline } from '../lib/online';
import { useOutbox } from '../lib/outboxContext';
import { useMe, useSession } from '../lib/session';
import { formatDateTime } from '../lib/format';
import { isUnsent, type OutboxItem, type OutboxStatus } from '../lib/outbox';
import { Sheet } from './Sheet';

const STATUS: Record<OutboxStatus, { key: MessageKey; tone: string }> = {
  pending: { key: 'off.statusPending', tone: 'warn' },
  syncing: { key: 'off.statusSyncing', tone: 'info' },
  synced: { key: 'off.statusSynced', tone: 'good' },
  needs_action: { key: 'off.statusNeedsAction', tone: 'bad' },
  conflict: { key: 'off.statusConflict', tone: 'neutral' },
  failed: { key: 'off.statusFailed', tone: 'bad' },
};

const KIND: Record<OutboxItem['kind'], MessageKey> = { 'check-in': 'off.kindCheckIn', 'check-out': 'off.kindCheckOut', report: 'off.kindReport' };

function StatusIcon({ status }: { status: OutboxStatus }) {
  if (status === 'synced') return <CircleCheck className="icon-sm" aria-hidden="true" />;
  if (status === 'syncing') return <LoaderCircle className="icon-sm spin" aria-hidden="true" />;
  if (status === 'pending') return <CloudUpload className="icon-sm" aria-hidden="true" />;
  return <CircleAlert className="icon-sm" aria-hidden="true" />;
}

export function OutboxList() {
  const { t, locale } = useI18n();
  const me = useMe();
  const outbox = useOutbox();
  const { refresh } = useSession();
  const online = useOnline();
  const [busy, setBusy] = useState<string | null>(null);
  if (!outbox) return null;
  if (outbox.items.length === 0) return <p className="muted m-0">{t('off.empty')}</p>;

  const run = async (id: string, fn: () => Promise<void> | void) => {
    setBusy(id);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="outbox-list">
      {[...outbox.items].reverse().map((item) => {
        const s = STATUS[item.status];
        const attendance = item.kind !== 'report';
        return (
          <li key={item.id} className={`outbox-item outbox-${item.status}`}>
            <div className="outbox-head">
              <strong>{item.kind === 'report' && item.report ? `${t(KIND[item.kind])}: ${item.report.title}` : t(KIND[item.kind])}</strong>
              <span className={`badge badge-${s.tone}`}>
                <StatusIcon status={item.status} />
                {t(s.key)}
              </span>
            </div>
            <p className="outbox-meta">
              {t('off.savedAt', { time: formatDateTime(item.createdAt, me.org.timezone, locale) })}
              {attendance && isUnsent(item) ? <span className="outbox-pending-verify">{t('off.pendingVerification')}</span> : null}
            </p>
            {item.status === 'needs_action' ? <p className="outbox-note">{t(item.action === 'signin' ? 'off.actionSignin' : 'off.actionPasskey')}</p> : null}
            {item.error && (item.status === 'failed' || item.status === 'conflict') ? <p className="outbox-note">{item.error}</p> : null}
            {isUnsent(item) && item.status !== 'syncing' ? (
              <div className="outbox-actions">
                {item.status === 'needs_action' && item.action === 'passkey' ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!online || busy !== null}
                    onClick={() => run(item.id, () => outbox.confirmWithPasskey(item.id))}
                  >
                    <KeyRound className="icon-sm" aria-hidden="true" />
                    {t('off.confirmPasskey')}
                  </button>
                ) : item.status === 'needs_action' && item.action === 'signin' ? (
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => run(item.id, refresh)}>
                    <LogIn className="icon-sm" aria-hidden="true" />
                    {t('off.signInAgain')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!online || busy !== null}
                    onClick={() => run(item.id, () => outbox.retry(item.id))}
                  >
                    <RefreshCw className="icon-sm" aria-hidden="true" />
                    {item.status === 'pending' ? t('off.sendNow') : t('off.retry')}
                  </button>
                )}
                <button type="button" className="btn btn-quiet btn-sm" disabled={busy !== null} onClick={() => outbox.remove(item.id)}>
                  <Trash2 className="icon-sm" aria-hidden="true" />
                  {t('off.remove')}
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Shown at the top of the worker app while offline or while anything is waiting to send. */
export function OfflineBanner() {
  const { t } = useI18n();
  const online = useOnline();
  const outbox = useOutbox();
  const [open, setOpen] = useState(false);
  const unsent = outbox?.unsentCount ?? 0;
  const needsYou = outbox?.items.some((i) => i.status === 'needs_action') ?? false;
  if (online && unsent === 0) return null;

  return (
    <>
      <div className={`offline-banner ${online ? 'is-online' : 'is-offline'}${needsYou ? ' needs-you' : ''}`} role="status">
        {online ? <ShieldAlert className="icon" aria-hidden="true" /> : <CloudOff className="icon" aria-hidden="true" />}
        <p>
          {online ? null : <strong>{t('off.bannerShort')}. </strong>}
          {online ? (needsYou ? t('off.needsYouBanner') : t('off.sendingBanner')) : t('off.banner')}
          {unsent > 0 ? <span className="offline-count"> {t('off.queued', { count: unsent })}</span> : null}
        </p>
        {unsent > 0 ? (
          <button type="button" className="btn btn-secondary btn-sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
            {t('off.view')}
          </button>
        ) : null}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('off.panelTitle')}>
        <p className="muted">{t('off.panelIntro')}</p>
        <OutboxList />
      </Sheet>
    </>
  );
}
