// Mobile Demonstration QR Access Modal
// Allows evaluators and judges to scan and access FairShift immediately on mobile smartphones.
import { useEffect, useState } from 'react';
import { generateQrSvg } from '../lib/qr';
import { Button, Notice } from './ui';
import { Smartphone, X, Copy, Check } from 'lucide-react';

export function MobileDemoQrModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  // The QR encodes only the address this page was opened from: never a guessed or hard-coded URL.
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const loopbackOnly = hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || hostname.startsWith('127.');
  let qrSvg = '';
  try {
    qrSvg = currentOrigin ? generateQrSvg(currentOrigin, 220) : '';
  } catch {
    qrSvg = '';
  }

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function copyUrl() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(currentOrigin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-card qr-modal-card" role="dialog" aria-modal="true" aria-labelledby="qr-modal-title">
        <div className="dispute-modal-header">
          <div className="flex items-center gap-2">
            <Smartphone className="icon text-amber" aria-hidden="true" />
            <h3 id="qr-modal-title" className="dialog-title m-0">
              Mobile Smartphone Demonstration
            </h3>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close modal">
            <X className="icon-sm" aria-hidden="true" />
          </button>
        </div>

        <div className="dispute-modal-body text-center flex flex-col items-center gap-3">
          <p className="text-sm muted m-0">Scan this QR code with your mobile camera to test FairShift's frontline worker interface on your smartphone.</p>

          {qrSvg ? (
            <div className="qr-code-frame" role="img" aria-label={`QR code for ${currentOrigin}`} dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <Notice kind="warning">
              <span className="small">This address is too long to show as a QR code. Copy it instead.</span>
            </Notice>
          )}

          {loopbackOnly && (
            <Notice kind="warning">
              <span className="small">
                <strong>This address only works on this computer.</strong> A phone cannot open {currentOrigin}. Open FairShift on this computer using its
                network address (for example http://192.168.x.x:8080) or the deployed URL, then show this code again.
              </span>
            </Notice>
          )}

          <div className="qr-url-box flex items-center justify-between w-full max-w-sm">
            <code className="text-xs truncate">{currentOrigin}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyUrl} title="Copy URL">
              {copied ? <Check className="icon-sm text-good" aria-hidden="true" /> : <Copy className="icon-sm" aria-hidden="true" />}
              <span className="small">{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <Notice kind="info">
            <span className="small">
              <strong>Local & Cloud Access:</strong> On a local server, the phone must be on the same Wi-Fi network. A deployed instance is reachable at its
              public HTTPS address.
            </span>
          </Notice>
        </div>

        <div className="dispute-modal-footer flex justify-between items-center">
          <span className="text-xs muted">The code contains only this page address, never sign-in details.</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
