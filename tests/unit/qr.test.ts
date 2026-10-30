import { describe, expect, it } from 'vitest';
import { generateQrSvg } from '../../src/client/lib/qr';

describe('FairShift Mobile QR Code Generator', () => {
  it('generates a valid SVG QR code for URLs without external dependencies', () => {
    const url = 'https://fairshift.app';
    const svg = generateQrSvg(url, 220);

    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 220 220"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<rect');
    expect(svg).toContain('fill="#2d0b29"');
  });

  it('handles localhost URLs and port numbers properly', () => {
    const localhostUrl = 'http://192.168.1.15:3000';
    const svg = generateQrSvg(localhostUrl, 180);

    expect(svg).toContain('width="180"');
    expect(svg).toContain('height="180"');
    expect(svg.length).toBeGreaterThan(500);
  });
});
