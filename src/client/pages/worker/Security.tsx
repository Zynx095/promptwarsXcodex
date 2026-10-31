// Passkey for check-in and check-out. Explains plainly what a passkey is and what FairShift keeps
// (a public key, never a fingerprint or a face), shows whether this phone can make one, lists the
// worker's passkeys with a way to remove a lost phone, and says what to do without one.
import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useMe } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { formatDateTime } from '../../lib/format';
import { deviceSupport, enrolPasskey, isCancelled, type DeviceSupport } from '../../lib/passkey';
import type { PasskeysResponse } from '../../../shared/types';
import { Async, Button, ConfirmDialog, ErrorBox, Field, Notice, Page } from '../../components/ui';

export function WorkerSecurity() {
  const { t, locale } = useI18n();
  const me = useMe();
  const list = useApi<PasskeysResponse>('/passkeys');
  const [support, setSupport] = useState<DeviceSupport | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    let live = true;
    void deviceSupport().then((s) => live && setSupport(s));
    return () => {
      live = false;
    };
  }, []);

  async function enrol() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const p = await enrolPasskey(label || t('pk.defaultLabel'));
      setDone(t('pk.enrolled', { label: p.label }));
      setLabel('');
      list.reload();
    } catch (err) {
      setError(
        isCancelled(err)
          ? new ApiError(0, 'PASSKEY_CANCELLED', t('pk.cancelled'))
          : err instanceof ApiError
            ? err
            : new ApiError(0, 'PASSKEY_FAILED', t('pk.deviceFailed')),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/passkeys/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: {} });
      setRemoving(null);
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('pk.title')} description={t('pk.intro')}>
      <section className="card security-explain">
        <h2 className="card-title">
          <ShieldCheck className="icon" aria-hidden="true" />
          {t('pk.whatTitle')}
        </h2>
        <ul className="security-points">
          <li>{t('pk.what1')}</li>
          <li>{t('pk.what2')}</li>
          <li>{t('pk.what3')}</li>
        </ul>
      </section>

      <Async state={list}>
        {(d) => (
          <>
            {!d.available ? <Notice kind="info">{t('pk.serverOff')}</Notice> : null}
            <section className="card" aria-labelledby="pk-mine">
              <h2 className="card-title" id="pk-mine">
                {t('pk.mine')}
              </h2>
              {d.items.length ? (
                <ul className="row-list passkey-list">
                  {d.items.map((p) => (
                    <li key={p.id} className="row-item row-static">
                      <span className="row-icon">
                        <Smartphone className="icon" aria-hidden="true" />
                      </span>
                      <span className="row-text">
                        <strong>{p.label}</strong>
                        <span>
                          {t('pk.added', { date: formatDateTime(p.createdAt, me.org.timezone, locale) })}
                          {p.lastUsedAt ? `. ${t('pk.lastUsed', { date: formatDateTime(p.lastUsedAt, me.org.timezone, locale) })}` : ''}
                        </span>
                      </span>
                      <Button variant="quiet" className="btn btn-quiet btn-sm" onClick={() => setRemoving({ id: p.id, label: p.label })}>
                        <Trash2 className="icon" aria-hidden="true" />
                        {t('pk.remove')}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{t('pk.none')}</p>
              )}
              {d.required ? <p className="hint security-required">{t('pk.requiredNote')}</p> : null}
            </section>

            {d.available ? (
              <section className="card" aria-labelledby="pk-add">
                <h2 className="card-title" id="pk-add">
                  <KeyRound className="icon" aria-hidden="true" />
                  {t('pk.addTitle')}
                </h2>
                {support === 'none' ? (
                  <Notice kind="warning">{t('pk.noSupport')}</Notice>
                ) : support === 'webauthn-only' ? (
                  <Notice kind="info">{t('pk.noScreenLock')}</Notice>
                ) : null}
                <Field label={t('pk.labelField')} hint={t('pk.labelHint')} optional>
                  <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder={t('pk.defaultLabel')} />
                </Field>
                <Button busy={busy} disabled={support === 'none'} onClick={() => void enrol()}>
                  <KeyRound className="icon" aria-hidden="true" />
                  {t('pk.add')}
                </Button>
                <div aria-live="polite">
                  {done ? <Notice kind="success">{done}</Notice> : null}
                  {error ? <ErrorBox error={error} /> : null}
                </div>
              </section>
            ) : null}
          </>
        )}
      </Async>

      <section className="card security-recovery" aria-labelledby="pk-recovery">
        <h2 className="card-title" id="pk-recovery">
          {t('pk.recoveryTitle')}
        </h2>
        <ul className="security-points">
          <li>{t('pk.recovery1')}</li>
          <li>{t('pk.recovery2')}</li>
          <li>{t('pk.recovery3')}</li>
        </ul>
      </section>

      <ConfirmDialog
        isOpen={removing !== null}
        title={t('pk.removeTitle', { label: removing?.label ?? '' })}
        message={t('pk.removeBody')}
        confirmLabel={t('pk.remove')}
        cancelLabel={t('action.cancel')}
        variant="danger"
        busy={busy}
        onConfirm={() => removing && void remove(removing.id)}
        onCancel={() => setRemoving(null)}
      />
    </Page>
  );
}
