import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Glassmorphism V2 design tokens and styling', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../../src/client/styles.css'), 'utf-8');

  it('declares the exact brand palette tokens', () => {
    // Ice Silver: #DDE3E8
    expect(css).toMatch(/--brand-ice-silver:\s*#dde3e8/i);
    // Deep Aubergine: #3A0F34
    expect(css).toMatch(/--brand-deep-aubergine:\s*#3a0f34/i);
    // Marigold: #EAAA00
    expect(css).toMatch(/--brand-marigold:\s*#eaaa00/i);
  });

  it('declares Glassmorphism V2 glass tokens and elevations', () => {
    expect(css).toContain('--glass-blur:');
    expect(css).toContain('--shadow:');
    expect(css).toContain('--shadow-raised:');
    expect(css).toContain('--shadow-dark:');
    expect(css).toContain('backdrop-filter: var(--glass-blur)');
  });

  it('ensures high-contrast Deep Aubergine text on Marigold actions', () => {
    // Deep Aubergine text on Marigold gives 7.9:1 contrast (exceeds WCAG AAA)
    expect(css).toMatch(/--c-gold-text:\s*#260822/i);
    expect(css).toContain('.btn-primary');
    expect(css).toContain('var(--c-gold-text)');
  });

  it('enforces accessibility guarantees: 44px touch target, visible focus outline, reduced motion', () => {
    expect(css).toMatch(/--tap:\s*44px/);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-duration: 0.01ms');
  });

  it('styles semantic status badges with icons/dots and text (never color alone)', () => {
    expect(css).toContain('.badge::before');
    expect(css).toContain('.badge-good');
    expect(css).toContain('.badge-warn');
    expect(css).toContain('.badge-bad');
    expect(css).toContain('.badge-info');
  });
});
