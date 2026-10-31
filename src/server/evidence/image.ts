// Safety photo intake: identify the format from the bytes themselves (never from a file name or a
// declared type alone), read the dimensions, and remove every metadata block that can identify a
// person, a device or a place (EXIF including GPS, XMP, IPTC, comments, text chunks) before the
// image is hashed and stored. Pixel data is not touched, so nothing here re-encodes the image.

export const EVIDENCE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type EvidenceMime = (typeof EVIDENCE_MIMES)[number];

/** After the client has resized the photo, anything larger than this is not a phone photo. */
export const MAX_EVIDENCE_BYTES = 1_500_000;
const MAX_DIMENSION = 8000;

export class ImageRejected extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_TYPE' | 'TYPE_MISMATCH' | 'TOO_LARGE' | 'CORRUPT' | 'TOO_MANY_PIXELS' | 'EMPTY',
    message: string,
  ) {
    super(message);
  }
}

export interface CleanImage {
  mime: EvidenceMime;
  bytes: Buffer;
  width: number;
  height: number;
  /** Names of the metadata blocks that were removed, for the audit trail. */
  removed: string[];
}

export function sniffMime(b: Buffer): EvidenceMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Validates and cleans one uploaded photo. Throws ImageRejected with a reason a person can act on. */
export function cleanImage(bytes: Buffer, declared: string): CleanImage {
  if (bytes.length === 0) throw new ImageRejected('EMPTY', 'The photo is empty.');
  if (bytes.length > MAX_EVIDENCE_BYTES) throw new ImageRejected('TOO_LARGE', 'The photo is too large. Take it again or choose a smaller one.');
  const mime = sniffMime(bytes);
  if (!mime) throw new ImageRejected('UNSUPPORTED_TYPE', 'Only JPEG, PNG or WebP photos can be added.');
  if (declared !== mime) throw new ImageRejected('TYPE_MISMATCH', 'The photo is not the type it claims to be.');
  const result = mime === 'image/jpeg' ? cleanJpeg(bytes) : mime === 'image/png' ? cleanPng(bytes) : cleanWebp(bytes);
  if (result.width < 1 || result.height < 1) throw new ImageRejected('CORRUPT', 'The photo could not be read.');
  if (result.width > MAX_DIMENSION || result.height > MAX_DIMENSION) throw new ImageRejected('TOO_MANY_PIXELS', 'The photo is too large.');
  return { mime, ...result };
}

// ---------- JPEG ----------
// Segments: FFD8, then FFxx markers with 2-byte big-endian lengths, until SOS (FFDA), after which
// the entropy-coded data runs to EOI. Kept: APP0 (JFIF), APP2 (ICC colour profile), APP14
// (Adobe colour transform) and all non-APP segments. Removed: APP1 (EXIF, GPS, XMP), APP3–APP13
// (including IPTC in APP13), APP15 and comments (FFFE).
function cleanJpeg(b: Buffer): { bytes: Buffer; width: number; height: number; removed: string[] } {
  const keep: Buffer[] = [b.subarray(0, 2)];
  const removed: string[] = [];
  let p = 2;
  let width = 0;
  let height = 0;
  while (p < b.length) {
    if (b[p] !== 0xff) throw new ImageRejected('CORRUPT', 'The photo could not be read.');
    let marker = b[p + 1]!;
    // Fill bytes
    while (marker === 0xff && p + 2 < b.length) {
      p++;
      marker = b[p + 1]!;
    }
    if (marker === 0xd9) {
      keep.push(b.subarray(p, p + 2));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      keep.push(b.subarray(p, p + 2));
      p += 2;
      continue;
    }
    if (p + 4 > b.length) throw new ImageRejected('CORRUPT', 'The photo could not be read.');
    const len = b.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > b.length) throw new ImageRejected('CORRUPT', 'The photo could not be read.');
    const segment = b.subarray(p, p + 2 + len);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && len >= 7) {
      height = b.readUInt16BE(p + 5);
      width = b.readUInt16BE(p + 7);
    }
    if (marker === 0xda) {
      // Start of scan: keep it and everything after (image data and EOI)
      keep.push(b.subarray(p));
      break;
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keepApp = marker === 0xe0 || marker === 0xe2 || marker === 0xee;
    if ((isApp && !keepApp) || marker === 0xfe) removed.push(marker === 0xfe ? 'comment' : marker === 0xe1 ? 'exif/xmp' : `app${marker - 0xe0}`);
    else keep.push(segment);
    p += 2 + len;
  }
  if (!width || !height) throw new ImageRejected('CORRUPT', 'The photo could not be read.');
  return { bytes: Buffer.concat(keep), width, height, removed };
}

// ---------- PNG ----------
// Chunks: 4-byte length, 4-byte type, data, 4-byte CRC. Removed: eXIf, tEXt, zTXt, iTXt and tIME.
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
function cleanPng(b: Buffer): { bytes: Buffer; width: number; height: number; removed: string[] } {
  const keep: Buffer[] = [b.subarray(0, 8)];
  const removed: string[] = [];
  let p = 8;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  while (p + 12 <= b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('latin1', p + 4, p + 8);
    if (p + 12 + len > b.length) throw new ImageRejected('CORRUPT', 'The photo could not be read.');
    if (type === 'IHDR') {
      width = b.readUInt32BE(p + 8);
      height = b.readUInt32BE(p + 12);
    }
    if (PNG_DROP.has(type)) removed.push(type);
    else keep.push(b.subarray(p, p + 12 + len));
    p += 12 + len;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd || !width || !height) throw new ImageRejected('CORRUPT', 'The photo could not be read.');
  return { bytes: Buffer.concat(keep), width, height, removed };
}

// ---------- WebP ----------
// RIFF container of chunks (4-byte FourCC, 4-byte little-endian size, data padded to even length).
// Removed: EXIF and XMP chunks; the matching flags in the VP8X header are cleared.
function cleanWebp(b: Buffer): { bytes: Buffer; width: number; height: number; removed: string[] } {
  const riffSize = b.readUInt32LE(4);
  if (riffSize + 8 > b.length || riffSize < 4) throw new ImageRejected('CORRUPT', 'The photo could not be read.');
  const chunks: Buffer[] = [];
  const removed: string[] = [];
  let p = 12;
  let width = 0;
  let height = 0;
  while (p + 8 <= 8 + riffSize) {
    const fourcc = b.toString('latin1', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    const padded = size + (size & 1);
    if (p + 8 + size > b.length) throw new ImageRejected('CORRUPT', 'The photo could not be read.');
    const chunk = Buffer.from(b.subarray(p, p + 8 + padded));
    if (fourcc === 'VP8X' && size >= 10) {
      chunk[8] = chunk[8]! & ~0x0c; // clear EXIF (0x08) and XMP (0x04) flags
      width = 1 + chunk.readUIntLE(12, 3);
      height = 1 + chunk.readUIntLE(15, 3);
    } else if (fourcc === 'VP8 ' && size >= 10 && !width) {
      width = chunk.readUInt16LE(14) & 0x3fff;
      height = chunk.readUInt16LE(16) & 0x3fff;
    } else if (fourcc === 'VP8L' && size >= 5 && !width) {
      const bits = chunk.readUInt32LE(9);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    if (fourcc === 'EXIF' || fourcc === 'XMP ') removed.push(fourcc.trim().toLowerCase());
    else chunks.push(chunk);
    p += 8 + padded;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'latin1');
  if (!width || !height) throw new ImageRejected('CORRUPT', 'The photo could not be read.');
  return { bytes: Buffer.concat([header, body]), width, height, removed };
}
