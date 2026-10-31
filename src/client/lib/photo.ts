// Prepares a photo on the worker's phone before it is sent: turns it upright, scales it to at most
// 1600 px on the long side and re-encodes it as JPEG. Re-encoding through a canvas carries over
// only pixels, so EXIF data (including GPS position, phone model and owner name) never leaves the
// device. The server strips metadata again regardless of what the client did.

export const MAX_SIDE = 1600;
/** Kept below the server's 1.5 MB limit with room to spare. */
const TARGET_BYTES = 1_350_000;

export interface PreparedPhoto {
  /** For the on-screen preview only; revoke with URL.revokeObjectURL when removed. */
  previewUrl: string;
  mime: 'image/jpeg';
  base64: string;
  width: number;
  height: number;
  bytes: number;
}

export class PhotoError extends Error {}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img>, which some browsers decode more formats with */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new PhotoError('unreadable');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoError('encode'))), 'image/jpeg', quality));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/') && file.type !== '') throw new PhotoError('not-image');
  if (file.size > 40_000_000) throw new PhotoError('too-large');
  const source = await decode(file);
  const w0 = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const h0 = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!w0 || !h0) throw new PhotoError('unreadable');
  let scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  let quality = 0.82;
  for (let attempt = 0; attempt < 5; attempt++) {
    const width = Math.max(1, Math.round(w0 * scale));
    const height = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) throw new PhotoError('encode');
    g.drawImage(source, 0, 0, width, height);
    const blob = await toBlob(canvas, quality);
    if (blob.size <= TARGET_BYTES) {
      if ('close' in source) source.close();
      return { previewUrl: URL.createObjectURL(blob), mime: 'image/jpeg', base64: await blobToBase64(blob), width, height, bytes: blob.size };
    }
    scale *= 0.8;
    quality = Math.max(0.6, quality - 0.08);
  }
  throw new PhotoError('too-large');
}
