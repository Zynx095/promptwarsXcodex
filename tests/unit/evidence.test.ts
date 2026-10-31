import { describe, expect, it } from 'vitest';
import { cleanImage, ImageRejected, MAX_EVIDENCE_BYTES, sniffMime } from '../../src/server/evidence/image';
import { interpret } from '../../src/server/services/vision';
import { GPS_MARKER, jpegWithMetadata, OWNER_MARKER, pngWithMetadata, webpWithMetadata } from '../fixtures/images';

const rejects = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ImageRejected);
    expect((err as ImageRejected).code).toBe(code);
    return;
  }
  throw new Error('expected the image to be rejected');
};

describe('safety photo intake', () => {
  it('removes EXIF (with GPS), XMP, IPTC and comments from JPEG photos and keeps the image data', () => {
    const original = jpegWithMetadata(1200, 900);
    expect(original.toString('latin1')).toContain(GPS_MARKER);
    const clean = cleanImage(original, 'image/jpeg');
    const text = clean.bytes.toString('latin1');
    expect(text).not.toContain(GPS_MARKER);
    expect(text).not.toContain(OWNER_MARKER);
    expect(text).not.toContain('Exif');
    expect(text).toContain('JFIF'); // kept
    expect(text).toContain('ICC_PROFILE'); // colour profile kept
    expect(clean).toMatchObject({ mime: 'image/jpeg', width: 1200, height: 900 });
    expect(clean.removed).toEqual(expect.arrayContaining(['exif/xmp', 'app13', 'comment']));
    // The scan data and end marker are untouched
    expect(clean.bytes.subarray(-9).equals(original.subarray(-9))).toBe(true);
  });

  it('removes text and EXIF chunks from PNG, and EXIF and XMP from WebP', () => {
    const png = cleanImage(pngWithMetadata(640, 480), 'image/png');
    expect(png.bytes.toString('latin1')).not.toContain(GPS_MARKER);
    expect(png.bytes.toString('latin1')).not.toContain(OWNER_MARKER);
    expect(png).toMatchObject({ width: 640, height: 480 });
    expect(png.removed).toEqual(['tEXt', 'eXIf']);

    const webp = cleanImage(webpWithMetadata(800, 600), 'image/webp');
    const text = webp.bytes.toString('latin1');
    expect(text).not.toContain(GPS_MARKER);
    expect(text).not.toContain(OWNER_MARKER);
    expect(webp).toMatchObject({ width: 800, height: 600 });
    expect(webp.bytes[20]! & 0x0c).toBe(0); // EXIF/XMP flags cleared in VP8X
    expect(webp.bytes.readUInt32LE(4)).toBe(webp.bytes.length - 8); // RIFF size rewritten
  });

  it('identifies the format from the bytes and rejects anything else', () => {
    expect(sniffMime(jpegWithMetadata())).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    rejects(() => cleanImage(Buffer.from('%PDF-1.7 not a photo'), 'image/jpeg'), 'UNSUPPORTED_TYPE');
    rejects(() => cleanImage(Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'), 'UNSUPPORTED_TYPE');
    // A PNG declared as a JPEG is refused rather than stored under the wrong type
    rejects(() => cleanImage(pngWithMetadata(), 'image/jpeg'), 'TYPE_MISMATCH');
    rejects(() => cleanImage(Buffer.alloc(0), 'image/jpeg'), 'EMPTY');
  });

  it('rejects truncated files, oversized files and absurd dimensions', () => {
    rejects(() => cleanImage(jpegWithMetadata().subarray(0, 40), 'image/jpeg'), 'CORRUPT');
    rejects(() => cleanImage(pngWithMetadata().subarray(0, 60), 'image/png'), 'CORRUPT');
    const big = Buffer.concat([jpegWithMetadata(), Buffer.alloc(MAX_EVIDENCE_BYTES)]);
    rejects(() => cleanImage(big, 'image/jpeg'), 'TOO_LARGE');
    rejects(() => cleanImage(jpegWithMetadata(20000, 100), 'image/jpeg'), 'TOO_MANY_PIXELS');
  });
});

describe('advisory photo analysis', () => {
  const required = ['helmet', 'vest', 'footwear'] as const;

  it('raises a fire finding only from the provider signals, with their scores', () => {
    const r = interpret(
      [
        { name: 'Smoke', score: 0.91 },
        { name: 'Building', score: 0.8 },
      ],
      [],
      required,
    );
    expect(r.outcome).toBe('potential_hazard');
    expect(r.findings).toEqual([{ kind: 'fire', outcome: 'potential_hazard', signals: [{ name: 'Smoke', score: 0.91 }] }]);
  });

  it('says gear may be missing only when people are visible and only for gear required at this workplace', () => {
    const people = [{ name: 'Person', score: 0.93 }];
    const r = interpret([{ name: 'Hard hat', score: 0.88 }], people, required);
    expect(r.findings.map((f) => [f.kind, f.outcome])).toEqual([
      ['vest', 'ppe_may_be_missing'],
      ['footwear', 'unable_to_determine'], // feet are often out of frame
    ]);
    expect(r.outcome).toBe('ppe_may_be_missing');
    // A campus with no gear required everywhere gets no gear findings at all
    expect(interpret([], people, []).findings).toEqual([]);
    // No people visible: nothing to say about gear
    expect(interpret([{ name: 'Wall', score: 0.9 }], [], required).outcome).toBe('no_visible_issue');
  });

  it('ignores weak signals and cannot determine anything from an empty answer', () => {
    expect(interpret([{ name: 'Fire', score: 0.3 }], [], required).outcome).toBe('no_visible_issue');
    expect(interpret([], [], required)).toEqual({ outcome: 'unable_to_determine', findings: [] });
  });

  it('asks for a manual inspection when electrical equipment or machinery is visible', () => {
    const r = interpret([{ name: 'Electrical wiring', score: 0.82 }], [{ name: 'Forklift', score: 0.7 }], []);
    expect(r.outcome).toBe('manual_inspection_required');
    expect(r.findings.map((f) => f.kind)).toEqual(['electrical', 'machinery']);
  });
});
