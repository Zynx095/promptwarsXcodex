import { useRef, useState, type FormEvent } from 'react';
import { FaceAngry, FaceGrinning, FaceNeutral, FaceSlightlyFrowning, FaceSlightlySmiling, TriangleAlert, UserX, Users } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { useMe } from '../../lib/session';
import { api, ApiError } from '../../lib/api';
import { getIndustry } from '../../../shared/industries';
import { Button, ErrorBox, Field, Notice, Page } from '../../components/ui';
import { DictateButton } from '../../components/Voice';

const SCALE = [
  { value: '1', icon: FaceAngry },
  { value: '2', icon: FaceSlightlyFrowning },
  { value: '3', icon: FaceNeutral },
  { value: '4', icon: FaceSlightlySmiling },
  { value: '5', icon: FaceGrinning },
] as const;

export function WorkerFeedback() {
  const { t, category } = useI18n();
  const me = useMe();
  const topics = getIndustry(me.org.industry).feedbackCategories;
  const [form, setForm] = useState({ category: '', rating: '', comment: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
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
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('fb.title')} description={t('fb.intro')}>
      <form className="step-form" onSubmit={submit} noValidate>
        <div ref={errorRef} tabIndex={-1} className="form-error-anchor">
          {error && !Object.keys(f).length ? <ErrorBox error={error} /> : null}
        </div>

        <fieldset className={`form-step${f['category'] ? ' has-error' : ''}`}>
          <legend id="topic-legend">{t('fb.topic')}</legend>
          <div
            className="choice-grid"
            role="radiogroup"
            aria-labelledby="topic-legend"
            aria-invalid={f['category'] ? true : undefined}
            aria-describedby={f['category'] ? 'topic-error' : undefined}
          >
            {topics.map((c) => (
              <label key={c.key} className="check">
                <input type="radio" name="topic" value={c.key} checked={form.category === c.key} onChange={() => setForm({ ...form, category: c.key })} />
                <span>{category('topic', c.key, c.label)}</span>
              </label>
            ))}
          </div>
          {f['category'] ? (
            <p className="field-error" id="topic-error">
              {f['category']}
            </p>
          ) : null}
        </fieldset>

        <fieldset className={`form-step${f['rating'] ? ' has-error' : ''}`}>
          <legend id="rating-legend">
            {t('fb.rating')} <span className="optional">({t('common.optional')})</span>
          </legend>
          <div
            className="rating-scale"
            role="radiogroup"
            aria-labelledby="rating-legend"
            aria-invalid={f['rating'] ? true : undefined}
            aria-describedby={f['rating'] ? 'rating-error' : undefined}
          >
            {SCALE.map(({ value, icon: Icon }) => (
              <label key={value} className="rating-option">
                <input type="radio" name="rating" value={value} checked={form.rating === value} onChange={() => setForm({ ...form, rating: value })} />
                <Icon className="rating-face" aria-hidden="true" />
                <span className="rating-number figure">{value}</span>
                <span className="visually-hidden">{t(`fb.scale${value}`)}</span>
              </label>
            ))}
          </div>
          <p className="rating-ends" aria-hidden="true">
            <span>{t('fb.scale1')}</span>
            <span>{t('fb.scale5')}</span>
          </p>
          {f['rating'] ? (
            <p className="field-error" id="rating-error">
              {f['rating']}
            </p>
          ) : null}
          {form.rating ? (
            <button type="button" className="btn btn-link btn-sm rating-clear" onClick={() => setForm({ ...form, rating: '' })}>
              {t('fb.clearRating')}
            </button>
          ) : null}
        </fieldset>

        <div className="form-step">
          <Field label={t('fb.comment')} optional error={f['comment']}>
            <textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} maxLength={1000} />
          </Field>
          <DictateButton onText={(text) => setForm((p) => ({ ...p, comment: `${p.comment}${p.comment ? ' ' : ''}${text}`.slice(0, 1000) }))} />
        </div>

        <section className="privacy-note" aria-labelledby="fb-privacy">
          <h2 id="fb-privacy">{t('fb.privacyTitle')}</h2>
          <ul>
            <li>
              <UserX className="icon" aria-hidden="true" />
              <span>{t('fb.privacy1')}</span>
            </li>
            <li>
              <Users className="icon" aria-hidden="true" />
              <span>{t('fb.privacy2')}</span>
            </li>
            <li>
              <TriangleAlert className="icon" aria-hidden="true" />
              <span>{t('fb.privacy3')}</span>
            </li>
          </ul>
        </section>

        <div aria-live="polite">{sent ? <Notice kind="success">{t('fb.thanks')}</Notice> : null}</div>
        <div className="form-actions step-actions">
          <Button type="submit" busy={busy} className="btn btn-primary btn-big">
            {t('fb.send')}
          </Button>
        </div>
      </form>
    </Page>
  );
}
