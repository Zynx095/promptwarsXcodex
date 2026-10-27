import { useState, type FormEvent } from 'react';
import { useI18n } from '../../lib/i18n';
import { useMe } from '../../lib/session';
import { api, ApiError } from '../../lib/api';
import { getIndustry } from '../../../shared/industries';
import { Button, Card, ErrorBox, Field, Notice, Page } from '../../components/ui';
import { DictateButton } from '../../components/Voice';

export function WorkerFeedback() {
  const { t, category } = useI18n();
  const me = useMe();
  const topics = getIndustry(me.org.industry).feedbackCategories;
  const [form, setForm] = useState({ category: '', rating: '', comment: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const f = error?.fields ?? {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await api('/feedback', {
        method: 'POST',
        body: { category: form.category, rating: form.rating ? Number(form.rating) : null, comment: form.comment },
      });
      setSent(true);
      setForm({ category: '', rating: '', comment: '' });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('fb.title')}>
      <Card title={t('fb.privacyTitle')} className="explain">
        <ul>
          <li>{t('fb.privacy1')}</li>
          <li>{t('fb.privacy2')}</li>
          <li>{t('fb.privacy3')}</li>
        </ul>
      </Card>
      <Card>
        <p>{t('fb.intro')}</p>
        <div aria-live="polite">{sent ? <Notice kind="success">{t('fb.thanks')}</Notice> : null}</div>
        <form onSubmit={submit} noValidate>
          {error && !Object.keys(f).length ? <ErrorBox error={error} /> : null}
          <Field label={t('fb.topic')} error={f['category']}>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">—</option>
              {topics.map((c) => (
                <option key={c.key} value={c.key}>
                  {category('topic', c.key, c.label)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('fb.rating')} optional error={f['rating']}>
            <select value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>
              <option value="">{t('fb.ratingNone')}</option>
              {(['1', '2', '3', '4', '5'] as const).map((r) => (
                <option key={r} value={r}>
                  {t(`fb.rating${r}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('fb.comment')} optional error={f['comment']}>
            <textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} maxLength={1000} />
          </Field>
          <DictateButton onText={(text) => setForm((f) => ({ ...f, comment: `${f.comment}${f.comment ? ' ' : ''}${text}`.slice(0, 1000) }))} />
          <Button type="submit" busy={busy}>
            {t('action.submit')}
          </Button>
        </form>
      </Card>
    </Page>
  );
}
