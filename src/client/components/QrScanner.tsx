// In-app QR scanning for site check-in, where the browser can read QR codes itself
// (BarcodeDetector). Elsewhere the phone's own camera app opens the code's link, which lands on
// the same check-in screen, so nothing is lost on phones without in-app scanning.
import { useEffect, useRef, useState } from 'react';
import { CameraOff, ScanQrCode } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useRouter } from '../lib/router';
import { SITE_QR_TOKEN_RE } from '../../shared/siteQr';
import { Sheet } from './Sheet';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? ctor : null;
}

/** Pulls the check-in token out of what a QR code holds: a FairShift link or the bare token. */
export function tokenFromScan(raw: string): string | null {
  const text = raw.trim();
  const fromPath = text.match(/\/c\/([^/?#\s]+)/)?.[1];
  const candidate = fromPath ? decodeURIComponent(fromPath) : text;
  return SITE_QR_TOKEN_RE.test(candidate) ? candidate : null;
}

export function QrScanButton({ className = 'btn btn-secondary' }: { className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <ScanQrCode className="icon" aria-hidden="true" />
        {t('qr.scan')}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('qr.scanTitle')}>
        {open ? <QrScanner onDone={() => setOpen(false)} /> : null}
      </Sheet>
    </>
  );
}

function QrScanner({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const Ctor = detectorCtor();
  const [problem, setProblem] = useState<'unsupported' | 'denied' | 'wrong' | null>(Ctor ? null : 'unsupported');

  useEffect(() => {
    if (!Ctor) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const detector = new Ctor({ formats: ['qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        await video.play().catch(() => undefined);
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            for (const c of codes) {
              const token = tokenFromScan(c.rawValue);
              if (token) {
                onDone();
                navigate(`/c/${encodeURIComponent(token)}`);
                return;
              }
              setProblem('wrong');
            }
          } catch {
            /* frame not ready yet */
          }
          timer = window.setTimeout(tick, 300);
        };
        void tick();
      })
      .catch(() => setProblem('denied'));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [Ctor, navigate, onDone]);

  if (problem === 'unsupported' || problem === 'denied') {
    return (
      <div className="qr-scan-fallback">
        <CameraOff className="icon" aria-hidden="true" />
        <p>{problem === 'denied' ? t('qr.cameraDenied') : t('qr.cameraUnavailable')}</p>
      </div>
    );
  }
  return (
    <div className="qr-scanner">
      <div className="qr-viewfinder">
        <video ref={videoRef} muted playsInline aria-label={t('qr.scanHint')} />
        <span className="qr-target" aria-hidden="true" />
      </div>
      <p className="muted m-0" aria-live="polite">
        {problem === 'wrong' ? t('qr.notFairShift') : t('qr.scanHint')}
      </p>
    </div>
  );
}
