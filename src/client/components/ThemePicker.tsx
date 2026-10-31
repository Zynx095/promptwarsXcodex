// Appearance choice: System, Light, Dark or Night. A round button in the top bar shows the current
// theme's icon; the sheet explains each option. Switching is instant and kept on this device.
import { useState } from 'react';
import { Monitor, Moon, MoonStar, Sun, type LucideIcon } from 'lucide-react';
import { useI18n, type MessageKey } from '../lib/i18n';
import { THEME_PREFS, useTheme, type ThemePref } from '../lib/theme';
import { Sheet } from './Sheet';

const OPTIONS: Record<ThemePref, { icon: LucideIcon; label: MessageKey; hint: MessageKey }> = {
  system: { icon: Monitor, label: 'theme.system', hint: 'theme.systemHint' },
  light: { icon: Sun, label: 'theme.light', hint: 'theme.lightHint' },
  dark: { icon: Moon, label: 'theme.dark', hint: 'theme.darkHint' },
  night: { icon: MoonStar, label: 'theme.night', hint: 'theme.nightHint' },
};

export function ThemePicker() {
  const { t } = useI18n();
  const { pref, resolved, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const Icon = OPTIONS[pref === 'system' ? resolved : pref].icon;

  return (
    <>
      <button
        type="button"
        className="theme-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('theme.title')}: ${t(OPTIONS[pref].label)}`}
        data-theme-picker=""
        onClick={() => setOpen(true)}
      >
        <Icon className="icon" aria-hidden="true" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('theme.title')} className="theme-sheet">
        <fieldset className="theme-options">
          <legend className="visually-hidden">{t('theme.title')}</legend>
          {THEME_PREFS.map((p) => {
            const o = OPTIONS[p];
            return (
              <label key={p} className={`check theme-option theme-option-${p}`}>
                <input type="radio" name="theme" value={p} checked={pref === p} onChange={() => setPref(p)} />
                <span className="theme-swatch" data-swatch={p} aria-hidden="true">
                  <o.icon className="icon" />
                </span>
                <span className="theme-option-text">
                  <strong>{t(o.label)}</strong>
                  <span className="tile-hint">{t(o.hint)}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <p className="muted small m-0">{t('theme.note')}</p>
      </Sheet>
    </>
  );
}
