// Taking or choosing safety photos. "Take a photo" asks the phone's own camera app (no live video
// stream, no camera permission prompt inside the page); "Choose a photo" opens the gallery or files.
// Either works alone, so a missing camera, a refused permission or a desktop computer never stops a
// report. Photos are prepared on the device (upright, resized, metadata removed) before upload.
import { useEffect, useId, useRef, useState } from 'react';
import { Camera, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { PhotoError, preparePhoto, type PreparedPhoto } from '../lib/photo';

export interface DraftPhoto extends PreparedPhoto {
  key: string;
  caption: string;
}

let counter = 0;

export function PhotoCapture({
  photos,
  onChange,
  max = 6,
  legend,
  hint,
}: {
  photos: DraftPhoto[];
  onChange: (next: DraftPhoto[]) => void;
  max?: number;
  legend: string;
  hint?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const replaceIndex = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(photos);
  useEffect(() => {
    latest.current = photos;
  }, [photos]);

  // Release preview images when the form goes away
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setProblem(null);
    setBusy(true);
    const next = [...latest.current];
    const replacing = replaceIndex.current;
    replaceIndex.current = null;
    let failed = 0;
    for (const file of Array.from(files)) {
      if (replacing === null && next.length >= max) {
        setProblem(t('photo.tooMany', { max }));
        break;
      }
      try {
        const prepared = await preparePhoto(file);
        const draft: DraftPhoto = { ...prepared, key: `p${++counter}`, caption: '' };
        if (replacing !== null && next[replacing]) {
          URL.revokeObjectURL(next[replacing]!.previewUrl);
          next[replacing] = { ...draft, caption: next[replacing]!.caption };
        } else next.push(draft);
      } catch (err) {
        failed++;
        if (!(err instanceof PhotoError)) console.warn('Photo could not be prepared', err);
      }
    }
    if (failed) setProblem(t('photo.unreadable'));
    onChange(next);
    setBusy(false);
  }

  const remove = (index: number) => {
    const p = photos[index];
    if (p) URL.revokeObjectURL(p.previewUrl);
    onChange(photos.filter((_, i) => i !== index));
  };

  const full = photos.length >= max;

  return (
    <fieldset className="form-step photo-capture" aria-describedby={`${id}-hint`}>
      <legend>
        {legend} <span className="optional">{t('common.optional')}</span>
      </legend>
      <p className="hint" id={`${id}-hint`}>
        {hint ?? t('photo.hint')}
      </p>
      <input
        ref={cameraRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/*"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="photo-actions">
        <button type="button" className="btn btn-secondary" disabled={full || busy} onClick={() => cameraRef.current?.click()}>
          <Camera className="icon" aria-hidden="true" />
          {t('photo.take')}
        </button>
        <button type="button" className="btn btn-secondary" disabled={full || busy} onClick={() => galleryRef.current?.click()}>
          <ImagePlus className="icon" aria-hidden="true" />
          {t('photo.choose')}
        </button>
      </div>
      <p className="photo-status" aria-live="polite">
        {busy ? (
          t('photo.preparing')
        ) : problem ? (
          <span className="field-error">{problem}</span>
        ) : photos.length ? (
          t('photo.count', { n: photos.length, max })
        ) : (
          ''
        )}
      </p>
      {photos.length ? (
        <ul className="photo-grid">
          {photos.map((p, i) => (
            <li key={p.key} className="photo-tile">
              <img src={p.previewUrl} alt={t('photo.previewAlt', { n: i + 1 })} width={p.width} height={p.height} />
              <label className="photo-caption">
                <span className="visually-hidden">{t('photo.caption', { n: i + 1 })}</span>
                <input
                  value={p.caption}
                  maxLength={200}
                  placeholder={t('photo.captionPlaceholder')}
                  onChange={(e) => onChange(photos.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))}
                />
              </label>
              <div className="photo-tile-actions">
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => {
                    replaceIndex.current = i;
                    cameraRef.current?.click();
                  }}
                  aria-label={t('photo.retakeN', { n: i + 1 })}
                >
                  <RefreshCw className="icon" aria-hidden="true" />
                  {t('photo.retake')}
                </button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => remove(i)} aria-label={t('photo.removeN', { n: i + 1 })}>
                  <Trash2 className="icon" aria-hidden="true" />
                  {t('photo.remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="photo-note">{t('photo.privacy')}</p>
    </fieldset>
  );
}

/** Sends prepared photos one at a time; returns how many failed. */
export async function uploadPhotos(
  reportId: string,
  stage: 'hazard' | 'remediation',
  photos: DraftPhoto[],
  onProgress?: (done: number) => void,
): Promise<number> {
  let failed = 0;
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i]!;
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/evidence`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, mime: p.mime, data: p.base64, caption: p.caption.trim() || undefined }),
      });
      if (!res.ok) failed++;
    } catch {
      failed++;
    }
    onProgress?.(i + 1);
  }
  return failed;
}
