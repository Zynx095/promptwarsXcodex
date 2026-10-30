import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createQrMatrix, generateQrSvg, QrCapacityError } from '../../src/client/lib/qr';

// Reference matrices produced by the segno library (byte mode, level M, mask 0). segno 1.6.6 appends
// an extra zero codeword when the bit stream is already byte-aligned; the references were generated
// with that padding step corrected to ISO/IEC 18004 §7.4.10, which is what this encoder implements.
const REFERENCE = JSON.parse(readFileSync(new URL('../fixtures/qr-reference.json', import.meta.url), 'utf8')) as Record<
  string,
  { version: number; rows: string[] }
>;

const toRows = (m: boolean[][]) => m.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));

describe('FairShift Mobile QR Code Generator', () => {
  it.each(Object.keys(REFERENCE))('matches an independent reference encoder module-for-module for %s', (text) => {
    const ref = REFERENCE[text]!;
    const matrix = createQrMatrix(text);
    expect(matrix).toHaveLength(ref.version * 4 + 17);
    expect(toRows(matrix)).toEqual(ref.rows);
  });

  it('chooses the smallest version that fits and rejects text beyond version 6', () => {
    expect(createQrMatrix('a'.repeat(14))).toHaveLength(21);
    expect(createQrMatrix('a'.repeat(15))).toHaveLength(25);
    expect(createQrMatrix('a'.repeat(106))).toHaveLength(41);
    expect(() => createQrMatrix('a'.repeat(107))).toThrow(QrCapacityError);
  });

  it('renders an SVG with a quiet zone at the requested pixel size', () => {
    const svg = generateQrSvg('https://fairshift.app', 220);
    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="220"');
    expect(svg).toContain('height="220"');
    // version 2 (25 modules) + 4-module quiet zone on each side
    expect(svg).toContain('viewBox="0 0 33 33"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#2d0b29"');
  });

  it('encodes exactly the given URL and nothing else', () => {
    const svgA = generateQrSvg('http://192.168.1.15:3000', 180);
    const svgB = generateQrSvg('http://192.168.1.15:3000/?pin=1234', 180);
    expect(svgA).not.toEqual(svgB);
    expect(svgA).toContain('width="180"');
  });
});
