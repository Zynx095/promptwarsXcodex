// Internationalisation system for FairShift.
// English is bundled as the source of truth and instant fallback;
// other Indian languages (Kannada, Hindi, Tamil, Telugu, Bengali) are loaded asynchronously
// and cached in memory.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import enRaw from '../locales/en.json';
import { formatMoney } from '../../shared/money';

export const en = enRaw;
export type MessageKey = keyof typeof en;
export type Dictionary = Partial<Record<MessageKey, string>>;

export const LANGUAGES = [
  { code: 'en', label: 'English', english: 'English', locale: 'en-IN' },
  { code: 'kn', label: 'ಕನ್ನಡ', english: 'Kannada', locale: 'kn-IN' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi', locale: 'hi-IN' },
  { code: 'ta', label: 'தமிழ்', english: 'Tamil', locale: 'ta-IN' },
  { code: 'te', label: 'తెలుగు', english: 'Telugu', locale: 'te-IN' },
  { code: 'bn', label: 'বাংলা', english: 'Bengali', locale: 'bn-IN' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'fairshift.lang';

const loaders: Record<Lang, () => Promise<{ default: Dictionary }>> = {
  en: () => Promise.resolve({ default: en }),
  kn: () => import('../locales/kn.json'),
  hi: () => import('../locales/hi.json'),
  ta: () => import('../locales/ta.json'),
  te: () => import('../locales/te.json'),
  bn: () => import('../locales/bn.json'),
};

const dictionaryCache = new Map<Lang, Dictionary>([['en', en]]);

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export interface I18n {
  lang: Lang;
  locale: string;
  setLang: (l: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Translates an industry category, falling back to the configured English label. */
  category: (kind: 'hazard' | 'topic', key: string, fallback: string) => string;
  isLoading: boolean;
}

const I18nContext = createContext<I18n | null>(null);

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (stored && LANGUAGES.some((l) => l.code === stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language?.toLowerCase() : 'en';
  for (const l of LANGUAGES) {
    if (l.code !== 'en' && nav.startsWith(l.code)) return l.code;
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    document.documentElement.lang = lang;
    if (dictionaryCache.has(lang)) return;
    let cancelled = false;
    loaders[lang]()
      .then((mod) => {
        if (cancelled) return;
        const dict = (mod as { default?: Dictionary }).default ?? (mod as unknown as Dictionary);
        dictionaryCache.set(lang, dict);
        setVersion((v) => v + 1);
      })
      .catch((err) => {
        console.warn(`Failed to load locale "${lang}":`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    void version;
    const activeDict = dictionaryCache.get(lang) ?? en;
    const activeLocale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'en-IN';
    const isLoading = !dictionaryCache.has(lang);

    return {
      lang,
      locale: activeLocale,
      setLang,
      isLoading,
      t: (key, vars) => {
        const text = activeDict[key] ?? en[key] ?? key;
        return interpolate(text, vars);
      },
      category: (kind, key, fallback) => {
        const catKey = `${kind}.${key}` as MessageKey;
        return activeDict[catKey] ?? en[catKey] ?? fallback;
      },
    };
  }, [lang, setLang, version]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Formats integer minor units (paise) as currency in the active language's conventions. */
export function useMoney(): (minor: number, currency?: string) => string {
  const { locale } = useI18n();
  return useCallback((minor: number, currency = 'INR') => formatMoney(minor, currency, locale), [locale]);
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}
