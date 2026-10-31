// "A new version is ready" prompt. The new version only takes over when the person chooses to.
import { Sparkles } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { applyUpdate, dismissUpdate, useUpdateAvailable } from '../lib/pwa';

export function AppUpdateBanner() {
  const { t } = useI18n();
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <div className="update-banner" role="status">
      <Sparkles className="icon" aria-hidden="true" />
      <p>{t('pwa.updateReady')}</p>
      <div className="update-actions">
        <button type="button" className="btn btn-quiet btn-sm" onClick={dismissUpdate}>
          {t('pwa.later')}
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={applyUpdate}>
          {t('pwa.updateNow')}
        </button>
      </div>
    </div>
  );
}
