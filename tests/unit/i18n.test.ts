import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, type Lang } from '../../src/client/lib/i18n';
import { formatMoney } from '../../src/shared/money';
import { formatDate } from '../../src/client/lib/format';

describe('FairShift Multilingual Architecture & Localization Completeness', () => {
  const localesDir = path.resolve(__dirname, '../../src/client/locales');
  const enPath = path.join(localesDir, 'en.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as Record<string, string>;

  it('configures all 6 target Indian languages with proper regional BCP-47 tags', () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(codes).toEqual(['en', 'kn', 'hi', 'ta', 'te', 'bn']);

    for (const l of LANGUAGES) {
      expect(l.locale).toMatch(/^[a-z]{2}-IN$/);
    }
  });

  it('ensures every language dictionary exists and parses as valid JSON', () => {
    for (const l of LANGUAGES) {
      const p = path.join(localesDir, `${l.code}.json`);
      expect(fs.existsSync(p), `Locale file for ${l.code} must exist`).toBe(true);

      const content = JSON.parse(fs.readFileSync(p, 'utf8'));
      expect(typeof content).toBe('object');
      expect(Object.keys(content).length).toBeGreaterThan(250);
    }
  });

  it('preserves all required parameter placeholders across translated dictionaries', () => {
    const paramRegex = /\{(\w+)\}/g;

    for (const l of LANGUAGES) {
      if (l.code === 'en') continue;
      const dict = JSON.parse(fs.readFileSync(path.join(localesDir, `${l.code}.json`), 'utf8')) as Record<string, string>;

      for (const [key, enText] of Object.entries(en)) {
        const enParams = [...enText.matchAll(paramRegex)].map((m) => m[1]).sort();
        if (enParams.length === 0) continue;

        const transText = dict[key];
        if (!transText) continue; // falls back to en

        const transParams = [...transText.matchAll(paramRegex)].map((m) => m[1]).sort();
        expect(transParams, `Placeholder mismatch in key "${key}" for language "${l.code}"`).toEqual(enParams);
      }
    }
  });

  it('covers core product differentiators: Money Jar, Dispute Notice, Heat Safety, and Proof', () => {
    const requiredPrefixes = ['jar.', 'dispute.', 'heat.', 'proof.', 'rep.', 'pay.', 'att.'];

    for (const l of LANGUAGES) {
      const dict = JSON.parse(fs.readFileSync(path.join(localesDir, `${l.code}.json`), 'utf8')) as Record<string, string>;
      for (const prefix of requiredPrefixes) {
        const count = Object.keys(dict).filter((k) => k.startsWith(prefix)).length;
        expect(count, `Language "${l.code}" should contain translations with prefix "${prefix}"`).toBeGreaterThan(0);
      }
    }
  });

  it('formats regional currency (INR) and calendar dates accurately across all locales', () => {
    const minorAmount = 2540050; // ₹25,400.50
    const testDate = '2026-10-30';

    for (const l of LANGUAGES) {
      const formattedMoney = formatMoney(minorAmount, 'INR', l.locale);
      expect(formattedMoney).toMatch(/(25,400\.50|২৫,৪০০\.৫০)/);

      const formattedDate = formatDate(testDate, l.locale);
      expect(formattedDate).toBeTruthy();
      expect(formattedDate.length).toBeGreaterThan(5);
    }
  });
});
