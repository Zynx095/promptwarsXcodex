// Employer console: the rotating check-in QR code for one site, for a tablet or screen at the gate.
// The server issues each code and decides when it expires; this panel only displays it, counts
// down to the next one (using the server's time, not this device's clock) and fetches the next.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Play, RotateCw, Square } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { generateQrSvg, QrCapacityError } from '../lib/qr';
import type { SiteDTO, SiteQrStateDTO } from '../../shared/types';
import { Badge, Button, ErrorBox, Loading, Notice } from './ui';

function qrSvgFor(token: string): { svg: string; linkMode: boolean } {
  try {
    return { svg: generateQrSvg(`${window.location.origin}/c/${token}`, 320), linkMode: true };
  } catch (err) {
    // A very long host name: encode the token alone (scan it from FairShift's own scanner)
    if (err instanceof QrCapacityError) return { svg: generateQrSvg(token, 320), linkMode: false };
    throw err;
  }
}

export function SiteQrPanel({ site }: { site: SiteDTO }) {
  const [state, setState] = useState<SiteQrStateDTO | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Server time minus this device's time, measured at each response; display only
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  const accept = useCallback((s: SiteQrStateDTO) => {
    setOffset(Date.parse(s.serverNow) - Date.now());
    setState(s);
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<SiteQrStateDTO>(`/admin/sites/${site.id}/qr`)
      .then((s) => !cancelled && accept(s))
      .catch((e: unknown) => !cancelled && setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'Could not load the QR code.')));
    return () => {
      cancelled = true;
    };
  }, [site.id, version, accept]);

  // Tick once a second for the countdown, and fetch the next code when the server said this one rotates
  const active = state?.active ?? false;
  const rotatesAt = state?.rotatesAt ? Date.parse(state.rotatesAt) : null;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  useEffect(() => {
    if (!active || rotatesAt === null) return;
    const delay = Math.max(0, rotatesAt - (Date.now() + offset)) + 250;
    const timer = window.setTimeout(load, delay);
    return () => window.clearTimeout(timer);
  }, [active, rotatesAt, offset, load]);
  const remaining = rotatesAt !== null ? Math.max(0, Math.ceil((rotatesAt - (now + offset)) / 1000)) : null;

  async function act(action: 'start' | 'stop' | 'refresh') {
    setBusy(true);
    try {
      accept(await api<SiteQrStateDTO>(`/admin/sites/${site.id}/qr/${action}`, { method: 'POST' }));
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', 'The QR display could not be updated.'));
    } finally {
      setBusy(false);
    }
  }

  const token = state?.token ?? null;
  const qr = useMemo(() => (token ? qrSvgFor(token) : null), [token]);

  if (error && !state) return <ErrorBox error={error} onRetry={load} />;
  if (!state) return <Loading />;

  return (
    <div className="qr-panel" ref={panelRef}>
      <div className="qr-panel-head">
        <div>
          <p className="qr-panel-site">{site.name}</p>
          <p className="muted small m-0">
            <span className="code-chip">{site.code}</span> {site.address}
          </p>
        </div>
        {state.active ? <Badge tone="good">QR check-in active</Badge> : <Badge tone="neutral">Inactive</Badge>}
      </div>
      {error ? <ErrorBox error={error} /> : null}

      {state.active && qr ? (
        <>
          <figure className="qr-display">
            {/* The SVG is generated locally from the server's token; it contains no external content */}
            <div className="qr-display-code" role="img" aria-label={`Check-in QR code for ${site.name}`} dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <figcaption>
              <span className="qr-countdown" aria-live="off">
                New code in <strong className="figure">{remaining ?? '…'}s</strong>
              </span>
              <span className="qr-rotate-bar" aria-hidden="true">
                <span style={{ width: `${remaining !== null ? (remaining / state.rotateSeconds) * 100 : 0}%` }} />
              </span>
            </figcaption>
          </figure>
          <p className="qr-instructions">
            Workers scan this with their phone camera (or <strong>Scan site QR</strong> in FairShift), check which site it is, and confirm. Each code changes
            every {state.rotateSeconds} seconds, is accepted for {state.ttlSeconds} seconds, and works once per worker. It shows the worker saw this screen
            recently; their sign-in, and passkey where they have one, shows who they are.
          </p>
          {!qr.linkMode ? (
            <Notice kind="warning">
              This address is too long for a link QR code, so the code holds the check-in token only. Workers must use Scan site QR in FairShift.
            </Notice>
          ) : null}
          <p className="muted small">Check-ins by QR at this site today: {state.checkInsToday}</p>
          <div className="btn-group">
            <Button variant="secondary" busy={busy} onClick={() => void act('refresh')}>
              <RotateCw className="icon-sm" aria-hidden="true" />
              New code now
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void panelRef.current?.requestFullscreen?.().catch(() => undefined);
              }}
            >
              <Maximize2 className="icon-sm" aria-hidden="true" />
              Full screen
            </Button>
            <Button variant="danger" busy={busy} onClick={() => void act('stop')}>
              <Square className="icon-sm" aria-hidden="true" />
              Stop QR check-in
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>
            Start a rotating QR code for this site to show on a phone, tablet or screen at the entrance. Stopping it, or refreshing it, makes the code on screen
            stop working at once.
          </p>
          <ol className="explain">
            <li>Start the display here and leave this screen open at the site.</li>
            <li>Workers scan it and confirm the site on their own phone.</li>
            <li>The check-in is recorded against this site, with the server’s time.</li>
          </ol>
          {!site.active ? <Notice kind="warning">This site is inactive. Activate it first.</Notice> : null}
          <Button busy={busy} disabled={!site.active} onClick={() => void act('start')}>
            <Play className="icon-sm" aria-hidden="true" />
            Start QR check-in
          </Button>
        </>
      )}
    </div>
  );
}
