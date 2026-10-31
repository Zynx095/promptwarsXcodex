import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Glassmorphism V2. Styles are split by concern: tokens (values), base (atmosphere, focus, motion),
// primitives and feature files (layout), and glass.css (which surfaces wear which material).
// These tests read the stylesheets and check the specification itself: the materials exist and
// differ, glass really blurs, every fill keeps text readable over the darkest point of the
// atmosphere, and nothing depends on backdrop-filter being available.
describe('FairShift design system: Glassmorphism V2', () => {
  const stylesDir = resolve(import.meta.dirname, '../../src/client/styles');
  const read = (file: string) => readFileSync(resolve(stylesDir, file), 'utf-8');
  const files = readdirSync(stylesDir).filter((f) => f.endsWith('.css'));
  const tokens = read('tokens.css');
  const base = read('base.css');
  const glass = read('glass.css');
  const primitives = read('primitives.css');
  const shell = read('shell.css');

  // The :root block before any @media/@supports override
  const rootBlock = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('\n}\n', tokens.indexOf(':root {')));

  function token(name: string, source = rootBlock): string {
    const m = source.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!m) throw new Error(`--${name} is not declared`);
    return m[1]!.replace(/\s+/g, ' ').trim();
  }
  function hex(name: string, source = rootBlock): string {
    const value = token(name, source);
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} is not a hex colour: ${value}`);
    return value.toLowerCase();
  }

  type RGB = [number, number, number];
  const parseHex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
  /** Every rgba()/hex colour stop in a token value, with its alpha. */
  function stops(value: string): { rgb: RGB; alpha: number }[] {
    const out: { rgb: RGB; alpha: number }[] = [];
    for (const m of value.matchAll(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)|#([0-9a-f]{6})\b/gi)) {
      if (m[5]) out.push({ rgb: parseHex(`#${m[5]}`), alpha: 1 });
      else out.push({ rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) });
    }
    if (out.length === 0) throw new Error(`no colours in ${value}`);
    return out;
  }
  const over = (top: RGB, alpha: number, bottom: RGB): RGB => top.map((v, i) => v * alpha + bottom[i]! * (1 - alpha)) as RGB;

  // WCAG 2.x relative luminance and contrast ratio
  function luminance(rgb: RGB): number {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }
  function contrast(a: RGB | string, b: RGB | string): number {
    const [x, y] = [typeof a === 'string' ? parseHex(a) : a, typeof b === 'string' ? parseHex(b) : b].map(luminance).sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  }
  /** The least opaque stop of a fill, composited over a backdrop: the worst case for text on it. */
  function worstComposite(fill: string, backdrop: RGB): RGB {
    const weakest = stops(fill).reduce((a, b) => (b.alpha < a.alpha ? b : a));
    return over(weakest.rgb, weakest.alpha, backdrop);
  }
  const minAlpha = (value: string) => Math.min(...stops(value).map((s) => s.alpha));
  const maxAlpha = (value: string) => Math.max(...stops(value).map((s) => s.alpha));

  const MATERIALS = ['glass-1', 'glass-2', 'glass-float', 'glass-dark'] as const;
  const WHITE: RGB = [255, 255, 255];

  it('declares the exact brand palette tokens', () => {
    // Ice Silver #DDE3E8, Deep Aubergine #3A0F34, Marigold #EAAA00
    expect(hex('fs-silver')).toBe('#dde3e8');
    expect(hex('fs-aubergine')).toBe('#3a0f34');
    expect(hex('fs-marigold')).toBe('#eaaa00');
    expect(tokens).toMatch(/--brand-ice-silver:\s*var\(--fs-silver\)/);
    expect(tokens).toMatch(/--brand-deep-aubergine:\s*var\(--fs-aubergine\)/);
    expect(tokens).toMatch(/--brand-marigold:\s*var\(--fs-marigold\)/);
  });

  it('defines distinct glass materials: fill, shadow and backdrop filter for each', () => {
    for (const m of MATERIALS) {
      expect(token(`${m}-fill`), m).toBeTruthy();
      expect(token(`${m}-shadow`), m).toMatch(/inset 0 1px 0 rgba\(255, 255, 255/); // a lit top edge
      expect(token(`${m}-filter`), m).toMatch(/^blur\(var\(--blur-[a-z]+\)\) saturate\(/);
    }
    for (const t of ['glass-control-fill', 'glass-control-edge', 'glass-well', 'glass-field', 'glass-paper', 'glass-bar-fill', 'glass-dark-glint']) {
      expect(token(t), t).toBeTruthy();
    }
    // The materials are not one value restated: fills and filters differ
    expect(new Set(MATERIALS.map((m) => token(`${m}-fill`))).size).toBe(MATERIALS.length);
    expect(new Set(MATERIALS.map((m) => token(`${m}-filter`))).size).toBe(MATERIALS.length);
  });

  it('blurs with real radii, softer on phones, and never on the controls that sit on glass', () => {
    const radius = (name: string, source = rootBlock) => Number(token(name, source).match(/^(\d+)px$/)?.[1]);
    const desktop = ['blur-soft', 'blur-panel', 'blur-bar', 'blur-float'].map((n) => radius(n));
    for (const r of desktop) expect(r).toBeGreaterThanOrEqual(8);
    for (const r of desktop) expect(r).toBeLessThanOrEqual(32);
    // Secondary < primary < floating: the materials are ordered by how far they sit from the page
    expect(desktop[0]).toBeLessThan(desktop[1]!);
    expect(desktop[1]).toBeLessThan(desktop[3]!);

    const phone = tokens.match(/@media \(max-width: 599px\) \{\s*:root \{([^}]*)\}/)?.[1];
    expect(phone, 'phone blur overrides').toBeTruthy();
    for (const n of ['blur-soft', 'blur-panel', 'blur-bar', 'blur-float']) {
      expect(radius(n, phone!), n).toBeLessThan(radius(n));
      expect(radius(n, phone!), n).toBeGreaterThanOrEqual(8);
    }

    // glass.css applies the filters to whole surfaces...
    for (const m of ['glass-1', 'glass-2', 'glass-float', 'glass-dark']) {
      expect(glass, m).toMatch(new RegExp(`(?<!-webkit-)backdrop-filter: var\\(--${m}-filter\\)`));
    }
    for (const surface of ['.card', '.row-list', '.jar', '.sheet', '.ws-topbar', '.as-topbar', '.timecard', '.ws-tabbar', '.as-sidebar', '.table-wrap']) {
      expect(glass, surface).toContain(`${surface}`);
    }
    // ...but the control material carries no filter of its own
    const control = glass.slice(glass.indexOf('/* ---------- Control'), glass.indexOf('/* Glass inside glass'));
    expect(control).not.toMatch(/backdrop-filter/);
    // and glass nested in glass does not filter twice
    expect(glass).toMatch(/:is\([^)]*\.card[^)]*\) :is\([^)]*\.table-wrap[^)]*\) \{\s*-webkit-backdrop-filter: none;\s*backdrop-filter: none;/);
  });

  it('keeps every surface translucent enough to be glass and opaque enough to read', () => {
    const primary = token('glass-1-fill');
    expect(minAlpha(primary)).toBeGreaterThanOrEqual(0.6);
    expect(maxAlpha(primary)).toBeLessThanOrEqual(0.9);
    const secondary = token('glass-2-fill');
    expect(maxAlpha(secondary)).toBeGreaterThanOrEqual(0.4);
    expect(maxAlpha(secondary)).toBeLessThan(minAlpha(primary));
    // Floating layers hold forms and long text: the densest light glass
    expect(minAlpha(token('glass-float-fill'))).toBeGreaterThanOrEqual(0.85);
    expect(minAlpha(token('glass-float-fill'))).toBeLessThan(1);
    expect(minAlpha(token('glass-bar-fill'))).toBeGreaterThanOrEqual(0.7);
    // Smoked glass carries light text: barely translucent
    expect(minAlpha(token('glass-dark-fill'))).toBeGreaterThanOrEqual(0.9);
    // Paper (statements, tables) and fields: reading first
    expect(minAlpha(token('glass-paper'))).toBeGreaterThanOrEqual(0.9);
    expect(minAlpha(token('glass-field'))).toBeGreaterThanOrEqual(0.85);
  });

  it('measures text contrast against the darkest point of the atmosphere and through every material', () => {
    const canvas = parseHex(hex('fs-canvas'));
    const floor = parseHex(hex('atmo-floor'));
    // The declared floor is no lighter than what the atmosphere layers actually produce together:
    // the dusk wash under the orchid light (upper left) and the canvas under the marigold lamp,
    // each with a ledger rule on top.
    const rule = stops(token('atmo-rule'))[0]!;
    const orchid = stops(token('atmo-orchid'))[0]!;
    const lamp = stops(token('atmo-lamp'))[0]!;
    const darkest = [
      over(rule.rgb, rule.alpha, over(orchid.rgb, orchid.alpha, parseHex(hex('atmo-dusk')))),
      over(rule.rgb, rule.alpha, over(lamp.rgb, lamp.alpha, canvas)),
    ].reduce((a, b) => (luminance(b) < luminance(a) ? b : a));
    expect(luminance(floor)).toBeLessThanOrEqual(luminance(darkest) + 0.005);

    // Text directly on the canvas
    expect(contrast(hex('fs-ink'), floor)).toBeGreaterThanOrEqual(7);
    expect(contrast(hex('fs-aubergine'), floor)).toBeGreaterThanOrEqual(7);
    for (const t of ['fs-ink-2', 'fs-ink-3', 'fs-danger', 'fs-caution', 'fs-info', 'fs-good']) {
      expect(contrast(hex(t), floor), t).toBeGreaterThanOrEqual(4.5);
    }

    // Text on light glass, at the least opaque stop of each fill, over the floor
    for (const fill of ['glass-1-fill', 'glass-2-fill', 'glass-float-fill', 'glass-bar-fill', 'glass-paper', 'glass-control-fill']) {
      const surface = worstComposite(token(fill), floor);
      for (const t of ['fs-ink', 'fs-ink-2', 'fs-ink-3', 'fs-aubergine', 'fs-good', 'fs-danger', 'fs-caution', 'fs-info']) {
        expect(contrast(hex(t), surface), `${t} on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
    }

    // Light text on smoked glass, at its most see-through stop over a white page behind it
    const smoked = worstComposite(token('glass-dark-fill'), WHITE);
    expect(contrast(hex('fs-on-dark'), smoked)).toBeGreaterThanOrEqual(7);
    for (const t of ['fs-on-dark-2', 'fs-on-dark-3', 'fs-marigold']) {
      expect(contrast(hex(t), smoked), t).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ensures high-contrast Deep Aubergine text on the lit Marigold action', () => {
    const primary = primitives.match(/\.btn-primary \{([^}]*)\}/)?.[1] ?? '';
    expect(primary).toMatch(/linear-gradient\(180deg, var\(--fs-marigold-lit\) 0%, var\(--fs-marigold\) 100%\)/);
    expect(primary).toMatch(/background-color: var\(--fs-marigold\)/);
    expect(primary).toMatch(/color: var\(--fs-aubergine-deep\)/);
    for (const stop of ['fs-marigold', 'fs-marigold-lit', 'fs-marigold-hover']) {
      expect(contrast(hex('fs-aubergine-deep'), hex(stop)), stop).toBeGreaterThanOrEqual(7);
    }
  });

  it('enforces accessibility guarantees: 44 px targets, visible focus, reduced motion and transparency', () => {
    const tap = Number(token('tap').match(/(\d+)px/)?.[1]);
    expect(tap).toBeGreaterThanOrEqual(44);
    // The floating tab bar keeps its items at least 44 px tall
    expect(Number(token('bottom-bar-h').match(/(\d+)px/)?.[1]) - 12).toBeGreaterThanOrEqual(44);
    expect(shell).toMatch(/min-height: calc\(var\(--bottom-bar-h\) - 12px\)/);
    expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid/);
    // Focus on smoked glass switches to marigold
    expect(glass).toMatch(/\.timecard,[\s\S]*?\{\s*--focus-color: var\(--fs-marigold\);/);
    expect(base).toContain('@media (prefers-reduced-motion: reduce)');
    expect(base).toContain('animation-duration: 0.01ms');
    const reduced = tokens.slice(tokens.indexOf('@media (prefers-reduced-transparency: reduce)'));
    expect(reduced).toMatch(/--glass-1-filter: none/);
    expect(reduced).toMatch(/--glass-float-filter: none/);
  });

  it('falls back to opaque surfaces of the same colours when backdrop-filter is unavailable', () => {
    const start = tokens.indexOf('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))');
    expect(start).toBeGreaterThan(-1);
    const fallback = tokens.slice(start, tokens.indexOf('\n}\n', start));
    for (const fill of [
      'glass-1-fill',
      'glass-2-fill',
      'glass-float-fill',
      'glass-bar-fill',
      'glass-dark-fill',
      'glass-control-fill',
      'glass-field',
      'glass-paper',
    ]) {
      const value = token(fill, fallback);
      expect(minAlpha(value), fill).toBe(1);
    }
    // The fallback smoked glass still carries light text
    expect(contrast(hex('fs-on-dark-3'), stops(token('glass-dark-fill', fallback))[0]!.rgb)).toBeGreaterThanOrEqual(4.5);
  });

  it('applies backdrop filters only through the material tokens, always with the -webkit- prefix', () => {
    // tokens.css only defines the filters (and tests support for them in @supports)
    const applied = files
      .filter((f) => f !== 'tokens.css')
      .map(read)
      .join('\n');
    const declarations = [...applied.matchAll(/(?<![-\w])backdrop-filter:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    const prefixed = [...applied.matchAll(/-webkit-backdrop-filter:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(declarations.length).toBeGreaterThan(5);
    expect(prefixed.sort()).toEqual([...declarations].sort());
    for (const d of declarations) expect(d).toMatch(/^(var\(--glass-[a-z0-9-]+-filter\)|none( !important)?)$/);
    // No raw blur() anywhere except the token definitions
    for (const f of files.filter((f) => f !== 'tokens.css')) expect(read(f), f).not.toMatch(/blur\(\d/);
    // Materials in glass.css are expressed only through tokens
    const materialDecls = [...glass.matchAll(/^\s*(background|box-shadow|border-color):\s*([^;]+);/gm)].map((m) => m[2]!);
    for (const v of materialDecls.filter((v) => !v.includes('rgba(58, 15, 52, 0.35)') && !v.startsWith('0 1px 0'))) {
      expect(v).toMatch(/var\(--/);
    }
  });

  it('paints the atmosphere once, behind everything, without filters or animation', () => {
    const layer = base.match(/body::before,\s*body::after\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(layer).toMatch(/position: fixed/);
    expect(layer).toMatch(/z-index: -1/);
    expect(layer).toMatch(/pointer-events: none/);
    const before = base.match(/body::before\s*\{([^}]*)\}/)?.[1] ?? '';
    for (const t of ['atmo-orchid', 'atmo-lamp', 'atmo-sheen', 'atmo-dusk']) expect(before).toContain(`var(--${t})`);
    expect(before).not.toMatch(/animation|filter/);
  });

  it('styles semantic status badges with icons/dots and text (never color alone)', () => {
    expect(primitives).toContain('.badge::before');
    for (const tone of ['good', 'warn', 'bad', 'info']) expect(primitives).toContain(`.badge-${tone}`);
  });

  it('keeps state colours readable on their tints', () => {
    for (const state of ['good', 'caution', 'danger', 'info']) {
      expect(contrast(hex(`fs-${state}`), hex(`fs-${state}-bg`)), state).toBeGreaterThanOrEqual(4.5);
    }
  });
});
