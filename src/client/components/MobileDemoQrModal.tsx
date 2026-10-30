// "Open on a phone": a QR code of the address this page was opened from, so a phone can open the
// worker app. It never encodes a guessed or hard-coded URL, and never any sign-in details.
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { generateQrSvg } from '../lib/qr';
import { useI18n } from '../lib/i18n';
import { Notice } from './ui';
import { Sheet } from './Sheet';

export function MobileDemoQrModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const loopbackOnly = hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || hostname.startsWith('127.');
  let qrSvg = '';
  if (isOpen && origin) {
    try {
      qrSvg = generateQrSvg(origin, 220);
    } catch {
      qrSvg = '';
    }
  }

  function copyUrl() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(origin).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  }

  return (
    <Sheet open={isOpen} onClose={onClose} title={t('qr.title')} className="qr-sheet">
      <div className="qr-body">
        <p className="m-0">{t('qr.intro')}</p>
        {qrSvg ? (
          <div className="qr-frame" role="img" aria-label={t('qr.codeLabel', { url: origin })} dangerouslySetInnerHTML={{ __html: qrSvg }} />
        ) : (
          <Notice kind="warning">{t('qr.tooLong')}</Notice>
        )}
        {loopbackOnly ? <Notice kind="warning">{t('qr.loopback', { url: origin })}</Notice> : null}
        <div className="qr-url">
          <code>{origin}</code>
          <button type="button" className="btn btn-quiet btn-sm" onClick={copyUrl}>
            {copied ? <Check className="icon-sm" aria-hidden="true" /> : <Copy className="icon-sm" aria-hidden="true" />}
            <span aria-live="polite">{copied ? t('qr.copied') : t('qr.copy')}</span>
          </button>
        </div>
        <p className="qr-note">
          {t('qr.network')} {t('qr.privacy')}
        </p>
      </div>
    </Sheet>
  );
}
