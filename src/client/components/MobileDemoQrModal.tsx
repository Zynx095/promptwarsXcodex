// Mobile Demonstration QR Access Modal
// Allows evaluators and judges to scan and access FairShift immediately on mobile smartphones.
import { useEffect, useState } from 'react';
import { generateQrSvg } from '../lib/qr';
import { Button, Notice } from './ui';
import { Smartphone, X, Copy, Check } from 'lucide-react';

export function MobileDemoQrModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const qrSvg = generateQrSvg(currentOrigin, 220);

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

          <div className="qr-code-frame" dangerouslySetInnerHTML={{ __html: qrSvg }} aria-label={`QR Code pointing to ${currentOrigin}`} />

          <div className="qr-url-box flex items-center justify-between w-full max-w-sm">
            <code className="text-xs truncate">{currentOrigin}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyUrl} title="Copy URL">
              {copied ? <Check className="icon-sm text-good" aria-hidden="true" /> : <Copy className="icon-sm" aria-hidden="true" />}
              <span className="small">{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <Notice kind="info">
            <span className="small">
              <strong>Local & Cloud Access:</strong> When evaluating on a local development server, ensure your mobile device is on the same local Wi-Fi network
              (or tunnel via port-forwarding). Production deployments automatically connect directly via public HTTPS.
            </span>
          </Notice>
        </div>

        <div className="dispute-modal-footer flex justify-between items-center">
          <span className="text-xs muted">Zero demo credentials exposed on public networks.</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
