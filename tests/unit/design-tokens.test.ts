import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Styles are split by concern: tokens, base, primitives, shells, then one file per feature.
// The remaining legacy sheet (styles.css) is included wherever a rule must hold everywhere.
describe('FairShift design tokens and styling', () => {
  const stylesDir = resolve(import.meta.dirname, '../../src/client/styles');
  const read = (file: string) => readFileSync(resolve(stylesDir, file), 'utf-8');
  const tokens = read('tokens.css');
  const base = read('base.css');
  const primitives = read('primitives.css');
  const legacy = readFileSync(resolve(import.meta.dirname, '../../src/client/styles.css'), 'utf-8');
  const all = [
    legacy,
    ...readdirSync(stylesDir)
      .filter((f) => f.endsWith('.css'))
      .map(read),
  ].join('\n');

  function hex(token: string): string {
    const m = tokens.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{6})\\b`, 'i'));
    if (!m) throw new Error(`--${token} is not declared as a hex colour`);
    return m[1]!.toLowerCase();
  }

  // WCAG 2.x relative luminance and contrast ratio
  function luminance(color: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(color.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }
  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  }

  it('declares the exact brand palette tokens', () => {
    // Ice Silver #DDE3E8, Deep Aubergine #3A0F34, Marigold #EAAA00
    expect(hex('fs-silver')).toBe('#dde3e8');
    expect(hex('fs-aubergine')).toBe('#3a0f34');
    expect(hex('fs-marigold')).toBe('#eaaa00');
    // The brand names used by older feature styles resolve to the same tokens
    expect(tokens).toMatch(/--brand-ice-silver:\s*var\(--fs-silver\)/);
    expect(tokens).toMatch(/--brand-deep-aubergine:\s*var\(--fs-aubergine\)/);
    expect(tokens).toMatch(/--brand-marigold:\s*var\(--fs-marigold\)/);
  });

  it('uses flat surfaces with three elevations instead of glass', () => {
    expect(tokens).toContain('--e-record:');
    expect(tokens).toContain('--e-float:');
    expect(tokens).toContain('--e-sheet:');
    expect(tokens).toMatch(/--glass-blur:\s*none/);
    expect(all).not.toMatch(/backdrop-filter:\s*blur\(/);
  });

  it('ensures high-contrast Deep Aubergine text on Marigold actions', () => {
    expect(primitives).toMatch(/\.btn-primary\s*\{[^}]*background:\s*var\(--fs-marigold\);[^}]*color:\s*var\(--fs-aubergine-deep\)/);
    expect(contrast(hex('fs-aubergine-deep'), hex('fs-marigold'))).toBeGreaterThanOrEqual(7);
  });

  it('enforces accessibility guarantees: touch target of at least 44px, visible focus outline, reduced motion', () => {
    expect(Number(tokens.match(/--tap:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(44);
    expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid/);
    expect(base).toContain('@media (prefers-reduced-motion: reduce)');
    expect(base).toContain('animation-duration: 0.01ms');
  });

  it('styles semantic status badges with icons/dots and text (never color alone)', () => {
    expect(primitives).toContain('.badge::before');
    for (const tone of ['good', 'warn', 'bad', 'info']) expect(primitives).toContain(`.badge-${tone}`);
  });

  it('keeps text readable: state colours on their tints and secondary text on the canvas meet WCAG AA', () => {
    for (const state of ['good', 'caution', 'danger', 'info']) {
      expect(contrast(hex(`fs-${state}`), hex(`fs-${state}-bg`)), state).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(hex('fs-ink'), hex('fs-canvas'))).toBeGreaterThanOrEqual(7);
    expect(contrast(hex('fs-ink-3'), hex('fs-canvas'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex('fs-ink-3'), hex('fs-paper'))).toBeGreaterThanOrEqual(4.5);
  });
});
