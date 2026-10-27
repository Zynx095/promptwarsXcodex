// Skill passport entries and the add-entry form, shared by worker and admin views.
import { useState, type FormEvent } from 'react';
import { useI18n } from '../lib/i18n';
import { api, ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import type { SkillDTO, SkillKind } from '../../shared/types';
import { Badge, Button, Empty, ErrorBox, Field, Notice } from './ui';

export function SkillList({ skills, onVerify }: { skills: SkillDTO[]; onVerify?: (s: SkillDTO, verified: boolean) => void }) {
  const { t, locale } = useI18n();
  if (skills.length === 0) return <Empty>{t('sk.none')}</Empty>;
  return (
    <ul className="list">
      {skills.map((s) => (
        <li key={s.id}>
          <div className="row">
            <span>
              <strong>{s.name}</strong> <span className="muted small">· {t(`sk.kind.${s.kind}`)}</span>
            </span>
            <span className="row row-tight">
              {s.verification === 'employer_verified' ? <Badge tone="good">{t('sk.verified')}</Badge> : <Badge tone="neutral">{t('sk.self')}</Badge>}
              {s.expired ? <Badge tone="bad">{t('sk.expired')}</Badge> : null}
            </span>
          </div>
          {s.description ? <p className="m-0">{s.description}</p> : null}
          <p className="muted small m-0">
            {s.issuer ? `${t('sk.issuer')}: ${s.issuer}. ` : ''}
            {s.issuedOn ? `${t('sk.issuedOn')}: ${formatDate(s.issuedOn, locale)}. ` : ''}
            {s.expiresOn ? `${t('sk.expiresOn')}: ${formatDate(s.expiresOn, locale)}. ` : ''}
            {s.verifiedByName ? t('sk.verifiedBy', { name: s.verifiedByName }) : ''}
          </p>
          {onVerify ? (
            <Button variant="link" onClick={() => onVerify(s, s.verification !== 'employer_verified')}>
              {s.verification === 'employer_verified' ? 'Remove employer check' : 'Mark as checked by employer'}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function SkillForm({ endpoint, onAdded, successText }: { endpoint: string; onAdded: () => void; successText: string }) {
  const { t } = useI18n();
  const empty = { kind: 'skill' as SkillKind, name: '', description: '', issuer: '', issuedOn: '', expiresOn: '' };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const f = error?.fields ?? {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api(endpoint, { method: 'POST', body: { ...form, issuedOn: form.issuedOn || null, expiresOn: form.expiresOn || null } });
      setForm(empty);
      setDone(true);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div aria-live="polite">{done ? <Notice kind="success">{successText}</Notice> : null}</div>
      {error && !Object.keys(f).length ? <ErrorBox error={error} /> : null}
      <div className="form-row">
        <Field label={t('sk.kind')}>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SkillKind })}>
            <option value="skill">{t('sk.kind.skill')}</option>
            <option value="training">{t('sk.kind.training')}</option>
            <option value="certification">{t('sk.kind.certification')}</option>
          </select>
        </Field>
        <Field label={t('sk.name')} error={f['name']}>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} />
        </Field>
      </div>
      <Field label={t('sk.description')} optional error={f['description']}>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
      </Field>
      <div className="form-row">
        <Field label={t('sk.issuer')} optional error={f['issuer']}>
          <input value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} maxLength={100} />
        </Field>
        <Field label={t('sk.issuedOn')} optional error={f['issuedOn']}>
          <input type="date" value={form.issuedOn} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} />
        </Field>
        <Field label={t('sk.expiresOn')} optional error={f['expiresOn']}>
          <input type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} />
        </Field>
      </div>
      <Button type="submit" busy={busy}>
        {t('action.save')}
      </Button>
    </form>
  );
}
