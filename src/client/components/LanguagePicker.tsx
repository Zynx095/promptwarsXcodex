// Language choice: a button that always shows the current language in its own script, and a
// sheet listing every language the same way, so a reader can find theirs without reading
// English. Switching re-renders in place; the current page and anything typed are kept.
import { useState } from 'react';
import { Languages } from 'lucide-react';
import { LANGUAGES, useI18n, type Lang } from '../lib/i18n';
import { Sheet } from './Sheet';

export function LanguagePicker({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <>
      <button
        type="button"
        className={`lang-button ${className ?? ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('common.language')}: ${current.label}`}
        data-lang-picker=""
        onClick={() => setOpen(true)}
      >
        <Languages className="icon" aria-hidden="true" />
        <span lang={current.code}>{current.label}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('common.language')} className="lang-sheet">
        <fieldset className="lang-options">
          <legend className="visually-hidden">{t('common.language')}</legend>
          {LANGUAGES.map((l) => (
            <label key={l.code} className="check lang-option">
              <input
                type="radio"
                name="language"
                value={l.code}
                checked={l.code === lang}
                onChange={() => {
                  setLang(l.code as Lang);
                  setOpen(false);
                }}
              />
              <span className="lang-option-text">
                <span className="lang-native" lang={l.code}>
                  {l.label}
                </span>
                <span className="lang-english" lang="en">
                  {l.english}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="muted small m-0">{t('lang.partialNote')}</p>
      </Sheet>
    </>
  );
}
