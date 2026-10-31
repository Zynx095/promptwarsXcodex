// Byte-level test images carrying the metadata a phone camera writes: EXIF with GPS coordinates,
// XMP, IPTC, comments and PNG/WebP text chunks. The pixel data is not real, but every structure
// the server parses (segments, chunks, dimensions) is laid out exactly as in genuine files.

const be16 = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const segment = (marker: number, body: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), be16(body.length + 2), body]);

export const GPS_MARKER = 'GPS 12.9716N 77.5946E';
export const OWNER_MARKER = 'Owner: Ravi Kumar, Pixel 7';

export function jpegWithMetadata(width = 1200, height = 900): Buffer {
  const jfif = segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
  const exif = segment(0xe1, Buffer.from(`Exif\0\0MM\0*${GPS_MARKER} ${OWNER_MARKER}`, 'latin1'));
  const xmp = segment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${GPS_MARKER}</x:xmpmeta>`, 'latin1'));
  const iptc = segment(0xed, Buffer.from(`Photoshop 3.0\0${OWNER_MARKER}`, 'latin1'));
  const icc = segment(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01fake-profile', 'latin1'));
  const comment = segment(0xfe, Buffer.from(OWNER_MARKER, 'latin1'));
  const dqt = segment(0xdb, Buffer.alloc(65, 1));
  const sof = segment(0xc0, Buffer.concat([Buffer.from([8]), be16(height), be16(width), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])]));
  const sos = segment(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]));
  const scan = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0x78, 0x9a]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, exif, xmp, iptc, icc, comment, dqt, sof, sos, scan, Buffer.from([0xff, 0xd9])]);
}

const be32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const pngChunk = (type: string, data: Buffer) => Buffer.concat([be32(data.length), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);

export function pngWithMetadata(width = 640, height = 480): Buffer {
  const ihdr = Buffer.concat([be32(width), be32(height), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from(`Author\0${OWNER_MARKER}`, 'latin1')),
    pngChunk('eXIf', Buffer.from(`MM\0*${GPS_MARKER}`, 'latin1')),
    pngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x60, 0, 0, 0, 2, 0, 1])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const le32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const riffChunk = (fourcc: string, data: Buffer) =>
  Buffer.concat([Buffer.from(fourcc, 'latin1'), le32(data.length), data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);

export function webpWithMetadata(width = 800, height = 600): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08 | 0x04; // EXIF and XMP present
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const vp8l = Buffer.alloc(10);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  const body = Buffer.concat([
    riffChunk('VP8X', vp8x),
    riffChunk('VP8L', vp8l),
    riffChunk('EXIF', Buffer.from(`MM\0*${GPS_MARKER}`, 'latin1')),
    riffChunk('XMP ', Buffer.from(`<x:xmpmeta>${OWNER_MARKER}</x:xmpmeta>`, 'latin1')),
  ]);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), le32(4 + body.length), Buffer.from('WEBP', 'latin1'), body]);
}
