// Draws the FairShift app icons (the aubergine square with the marigold F) as PNG files for the
// web app manifest, with no image tooling: the mark is a rounded square and three rectangles, so it
// is rasterised here directly with 4x4 supersampling and written with zlib.
//   node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'src/client/public/icons';
const AUBERGINE = [0x3a, 0x0f, 0x34];
const MARIGOLD = [0xea, 0xaa, 0x00];
// The F in the 32-unit design grid of the favicon (see index.html)
const F_RECTS = [
  [10, 7, 15, 25],
  [15, 7, 23, 11.5],
  [15, 14.7, 21.5, 19],
];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Rounded-square test in the 32-unit grid. */
function inRoundedSquare(x, y, r) {
  if (x < 0 || y < 0 || x > 32 || y > 32) return false;
  const cx = Math.min(Math.max(x, r), 32 - r);
  const cy = Math.min(Math.max(y, r), 32 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * maskable: the background fills the whole square (no rounded corners) and the F is drawn at
 * `fScale` around the centre, inside the safe zone that launchers may crop to a circle.
 */
function draw(size, { maskable = false, fScale = 1 } = {}) {
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) / size) * 32;
          const y = ((py + (sy + 0.5) / S) / size) * 32;
          const inside = maskable || inRoundedSquare(x, y, 8);
          if (!inside) continue;
          bg++;
          const fx = 16 + (x - 16) / fScale;
          const fy = 16 + (y - 16) / fScale;
          if (F_RECTS.some(([x0, y0, x1, y1]) => fx >= x0 && fx < x1 && fy >= y0 && fy < y1)) fg++;
        }
      }
      const i = (py * size + px) * 4;
      const coverage = bg / (S * S);
      const mix = bg ? fg / bg : 0;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(AUBERGINE[c] * (1 - mix) + MARIGOLD[c] * mix);
      out[i + 3] = Math.round(coverage * 255);
    }
  }
  return png(size, out);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/icon-192.png`, draw(192));
writeFileSync(`${OUT}/icon-512.png`, draw(512));
writeFileSync(`${OUT}/maskable-512.png`, draw(512, { maskable: true, fScale: 0.72 }));
writeFileSync(`${OUT}/apple-touch-icon.png`, draw(180, { maskable: true, fScale: 0.8 }));
console.log(`Icons written to ${OUT}`);
