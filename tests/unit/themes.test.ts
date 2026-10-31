// Appearance themes: Light (tokens.css), Dark and Night (themes.css). Checks that each theme is
// complete, readable (WCAG contrast through its glass, measured the same way as Light), distinct
// from the others, and applied before the first paint by public/theme-init.js.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { THEME_COLORS, resolveTheme } from '../../src/client/lib/theme';

const styles = resolve(import.meta.dirname, '../../src/client/styles');
const tokensCss = readFileSync(resolve(styles, 'tokens.css'), 'utf8');
const themesCss = readFileSync(resolve(styles, 'themes.css'), 'utf8');

function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block ${selector}`);
  return source.slice(start, source.indexOf('\n}\n', start));
}
const light = block(tokensCss, ':root');
const themes = { light, dark: block(themesCss, ":root[data-theme='dark']"), night: block(themesCss, ":root[data-theme='night']") };

/** A token from the theme block, falling back to Light (the theme only overrides what changes). */
function token(theme: keyof typeof themes, name: string): string {
  const m = themes[theme].match(new RegExp(`--${name}:\\s*([^;]+);`)) ?? light.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`--${name} missing`);
  return m[1]!.replace(/\s+/g, ' ').trim();
}

type RGB = [number, number, number];
const parseHex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
function stops(value: string): { rgb: RGB; alpha: number }[] {
  const out: { rgb: RGB; alpha: number }[] = [];
  for (const m of value.matchAll(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)|#([0-9a-f]{6})\b/gi)) {
    if (m[5]) out.push({ rgb: parseHex(`#${m[5]}`), alpha: 1 });
    else out.push({ rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) });
  }
  return out;
}
const over = (top: RGB, a: number, bottom: RGB): RGB => top.map((v, i) => v * a + bottom[i]! * (1 - a)) as RGB;
function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
const hex = (theme: keyof typeof themes, name: string) => parseHex(token(theme, name));
/** Worst case for text: the fill's most transparent and its lightest stop composited over the backdrop. */
function surfaces(fill: string, backdrop: RGB): RGB[] {
  return stops(fill).map((s) => over(s.rgb, s.alpha, backdrop));
}

const TEXT = ['fs-ink', 'fs-ink-2', 'fs-ink-3', 'fs-aubergine', 'fs-good', 'fs-danger', 'fs-caution', 'fs-info'];
const FILLS = ['glass-1-fill', 'glass-2-fill', 'glass-float-fill', 'glass-bar-fill', 'glass-paper', 'glass-control-fill', 'glass-field'];

describe('appearance themes', () => {
  it('redefines every colour family for Dark and Night', () => {
    for (const theme of ['dark', 'night'] as const) {
      for (const name of [
        'fs-canvas',
        'fs-paper',
        'fs-line',
        'fs-line-strong',
        'fs-ink',
        'fs-ink-2',
        'fs-ink-3',
        'fs-aubergine',
        'fs-good',
        'fs-good-bg',
        'fs-caution',
        'fs-caution-bg',
        'fs-danger',
        'fs-danger-bg',
        'fs-info',
        'fs-info-bg',
        'atmo-floor',
        'glass-1-fill',
        'glass-2-fill',
        'glass-float-fill',
        'glass-bar-fill',
        'glass-dark-fill',
        'glass-control-fill',
        'glass-field',
        'glass-paper',
        'glass-well',
      ]) {
        expect(themes[theme], `${theme} ${name}`).toMatch(new RegExp(`--${name}:`));
      }
      expect(themes[theme]).toMatch(/color-scheme: dark/);
    }
  });

  it('keeps body text readable on every surface of every theme (WCAG AA, 7:1 for main text)', () => {
    for (const theme of ['light', 'dark', 'night'] as const) {
      const floor = hex(theme, 'atmo-floor');
      expect(contrast(hex(theme, 'fs-ink'), floor), `${theme} ink on floor`).toBeGreaterThanOrEqual(7);
      for (const fill of FILLS) {
        for (const surface of surfaces(token(theme, fill), floor)) {
          for (const t of TEXT) expect(contrast(hex(theme, t), surface), `${theme}: ${t} on ${fill}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const state of ['good', 'caution', 'danger', 'info']) {
        expect(contrast(hex(theme, `fs-${state}`), hex(theme, `fs-${state}-bg`)), `${theme} ${state}`).toBeGreaterThanOrEqual(4.5);
      }
      // Light text on the smoked glass (time card, tab bar, sidebar)
      for (const surface of surfaces(token(theme, 'glass-dark-fill'), floor)) {
        expect(contrast(hex(theme, 'fs-on-dark'), surface), `${theme} on-dark`).toBeGreaterThanOrEqual(7);
        expect(contrast(hex(theme, 'fs-on-dark-3'), surface), `${theme} on-dark-3`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(hex(theme, 'fs-marigold'), surface), `${theme} marigold`).toBeGreaterThanOrEqual(4.5);
      }
      // The main action: dark text on marigold in every theme
      for (const stop of ['fs-marigold', 'fs-marigold-lit', 'fs-marigold-hover']) {
        expect(contrast(hex(theme, 'fs-aubergine-deep'), hex(theme, stop)), `${theme} ${stop}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('makes Night distinct from Dark: darker canvas, softer (non-white) text, dimmer accents', () => {
    expect(token('dark', 'fs-canvas')).not.toBe(token('night', 'fs-canvas'));
    expect(luminance(hex('night', 'fs-canvas'))).toBeLessThan(luminance(hex('dark', 'fs-canvas')));
    expect(luminance(hex('night', 'fs-ink'))).toBeLessThan(luminance(hex('dark', 'fs-ink')));
    expect(luminance(hex('night', 'fs-marigold'))).toBeLessThan(luminance(hex('light', 'fs-marigold')));
    expect(luminance(hex('night', 'fs-on-dark'))).toBeLessThan(luminance(hex('light', 'fs-on-dark')));
    // Main text never pure white at night, but still comfortably readable
    expect(token('night', 'fs-ink')).not.toMatch(/#fff/i);
    expect(contrast(hex('night', 'fs-ink'), hex('night', 'fs-canvas'))).toBeLessThan(contrast(hex('dark', 'fs-ink'), hex('dark', 'fs-canvas')));
    // The atmosphere is quieter at night
    expect(stops(token('night', 'atmo-orchid'))[0]!.alpha).toBeLessThan(stops(token('dark', 'atmo-orchid'))[0]!.alpha);
  });

  it('keeps the brand palette: Light tokens are untouched, and Dark/Night are not inversions', () => {
    expect(token('light', 'fs-aubergine')).toBe('#3a0f34');
    expect(token('light', 'fs-silver')).toBe('#dde3e8');
    expect(token('light', 'fs-marigold')).toBe('#eaaa00');
    expect(token('dark', 'fs-marigold')).toBe('#eaaa00');
    // Smoked glass stays aubergine in every theme
    for (const theme of ['dark', 'night'] as const) {
      const [r, g, b] = stops(token(theme, 'glass-dark-fill'))[0]!.rgb;
      expect(r).toBeGreaterThan(g);
      expect(b).toBeGreaterThan(g);
    }
  });

  it('has opaque Dark and Night fallbacks without backdrop-filter and for reduced transparency', () => {
    const supports = tokensCss.slice(tokensCss.lastIndexOf('@supports not'));
    const reduced = tokensCss.slice(tokensCss.lastIndexOf('@media (prefers-reduced-transparency: reduce)'));
    for (const part of [supports, reduced]) {
      for (const theme of ['dark', 'night']) {
        const b = part.slice(part.indexOf(`:root[data-theme='${theme}'] {`));
        expect(b.slice(0, b.indexOf('}'))).toMatch(/--glass-1-fill: linear-gradient\(155deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)/);
      }
    }
    expect(reduced).toMatch(/:root\[data-theme='night'\] \{[^}]*--glass-float-filter: none/);
  });

  it('styles charts, dialogs, tables and notifications in the dark themes, and keeps QR codes on white', () => {
    for (const selector of ['.sheet-footer', 'tbody tr:hover', '.chart-peak span', '.notif-list', '.skeleton-shimmer', '.btn-danger', '.qr-display-code']) {
      expect(themesCss, selector).toContain(`:root:is([data-theme='dark'], [data-theme='night']) ${selector}`);
    }
    expect(themesCss).toMatch(/\.qr-display-code \{\s*background: #fff;/);
  });
});

describe('theme choice and first paint', () => {
  const script = readFileSync(resolve(import.meta.dirname, '../../src/client/public/theme-init.js'), 'utf8');

  function runInit(stored: string | null, prefersDark: boolean, storageThrows = false) {
    const attrs: Record<string, string> = {};
    const meta = { content: '#000', setAttribute: (_: string, v: string) => (meta.content = v) };
    const root = { setAttribute: (k: string, v: string) => (attrs[k] = v), style: { colorScheme: '' } };
    vm.runInNewContext(script, {
      localStorage: {
        getItem: () => {
          if (storageThrows) throw new Error('blocked');
          return stored;
        },
      },
      window: { matchMedia: () => ({ matches: prefersDark }) },
      document: { documentElement: root, querySelectorAll: () => [meta] },
    });
    return { theme: attrs['data-theme'], pref: attrs['data-theme-pref'], scheme: root.style.colorScheme, color: meta.content };
  }

  it('follows the device by default and applies a saved choice before React loads', () => {
    expect(runInit(null, false)).toEqual({ theme: 'light', pref: 'system', scheme: 'light', color: THEME_COLORS.light });
    expect(runInit(null, true)).toEqual({ theme: 'dark', pref: 'system', scheme: 'dark', color: THEME_COLORS.dark });
    expect(runInit('night', false)).toEqual({ theme: 'night', pref: 'night', scheme: 'dark', color: THEME_COLORS.night });
    expect(runInit('light', true).theme).toBe('light');
    expect(runInit('purple', true)).toMatchObject({ theme: 'dark', pref: 'system' });
    expect(runInit('dark', false, true)).toMatchObject({ theme: 'light', pref: 'system' });
  });

  it('uses the same rules and colours as the React theme provider', () => {
    for (const pref of ['system', 'light', 'dark', 'night'] as const) {
      for (const dark of [true, false]) expect(runInit(pref, dark).theme).toBe(resolveTheme(pref, dark));
    }
    for (const [name, color] of Object.entries(THEME_COLORS)) expect(script).toContain(`${name}: '${color}'`);
  });
});
