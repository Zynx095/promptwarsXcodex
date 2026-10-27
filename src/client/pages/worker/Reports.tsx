import { useState, type FormEvent } from 'react';
import { useI18n } from '../../lib/i18n';
import { useMe } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { Link, useRouter } from '../../lib/router';
import { formatDateTime } from '../../lib/format';
import { getIndustry } from '../../../shared/industries';
import { SEVERITIES, type SafetyReportDTO, type Severity } from '../../../shared/types';
import { Async, Badge, Button, Card, Empty, ErrorBox, Field, Notice, Page, ReportStatusBadge, SeverityBadge } from '../../components/ui';
import { DictateButton } from '../../components/Voice';
import { ReportDetail } from '../../components/ReportDetail';

export function WorkerReports() {
  const { t, locale } = useI18n();
  const me = useMe();
  const mine = useApi<{ items: SafetyReportDTO[] }>('/reports/mine');
  return (
    <Page
      title={t('rep.title')}
      actions={
        <Link to="/worker/reports/new" className="btn btn-primary">
          {t('rep.new')}
        </Link>
      }
    >
      <Card title={t('rep.mine')}>
        <Async state={mine}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>{t('rep.none')}</Empty>
            ) : (
              <ul className="list">
                {d.items.map((r) => (
                  <li key={r.id}>
                    <div className="row">
                      <Link to={`/worker/reports/${r.id}`}>{r.title}</Link>
                      <ReportStatusBadge status={r.status} />
                    </div>
                    <p className="muted small" style={{ margin: 0 }}>
                      <SeverityBadge severity={r.severity} /> {formatDateTime(r.createdAt, me.org.timezone, locale)}{' '}
                      {r.confidential ? <Badge tone="info">Confidential</Badge> : null}
                    </p>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </Card>
    </Page>
  );
}

export function WorkerReportNew() {
  const { t, category } = useI18n();
  const me = useMe();
  const { navigate } = useRouter();
  const industry = getIndustry(me.org.industry);
  const [form, setForm] = useState({ category: '', severity: '' as Severity | '', title: '', location: '', description: '', confidential: false });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const f = error?.fields ?? {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<SafetyReportDTO>('/reports', { method: 'POST', body: form });
      navigate(`/worker/reports/${created.id}?created=1`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', t('common.error')));
      window.scrollTo(0, 0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('rep.new')}>
      <Card>
        <form onSubmit={submit} noValidate>
          {error ? <ErrorBox error={error} /> : null}
          <Field label={t('rep.category')} error={f['category']}>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
              <option value="">—</option>
              {industry.hazardCategories.map((c) => (
                <option key={c.key} value={c.key}>
                  {category('hazard', c.key, c.label)}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className={f['severity'] ? 'has-error' : ''}>
            <legend>{t('rep.severity')}</legend>
            {SEVERITIES.map((s) => (
              <label key={s} className="check">
                <input type="radio" name="severity" value={s} checked={form.severity === s} onChange={() => setForm({ ...form, severity: s })} />
                <span>{t(`sev.${s}`)}</span>
              </label>
            ))}
            {f['severity'] ? <p className="field-error">{f['severity']}</p> : null}
          </fieldset>
          <Field label={t('rep.titleField')} hint={t('rep.titleHint')} error={f['title']}>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />
          </Field>
          <Field label={t('rep.location')} error={f['location']}>
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={120} />
          </Field>
          <Field label={t('rep.description')} hint={t('rep.descriptionHint')} error={f['description']}>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
          </Field>
          <DictateButton onText={(text) => setForm((f) => ({ ...f, description: `${f.description}${f.description ? ' ' : ''}${text}`.slice(0, 2000) }))} />
          <label className="check">
            <input type="checkbox" checked={form.confidential} onChange={(e) => setForm({ ...form, confidential: e.target.checked })} />
            <span>
              <strong>{t('rep.confidential')}</strong>
              <br />
              <span className="small muted">{t('rep.confidentialHint')}</span>
            </span>
          </label>
          <div className="form-actions" style={{ marginTop: 16 }}>
            <Button type="submit" busy={busy}>
              {t('action.submit')}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/worker/reports')}>
              {t('action.cancel')}
            </Button>
          </div>
        </form>
      </Card>
    </Page>
  );
}

export function WorkerReportView({ id }: { id: string }) {
  const { t } = useI18n();
  const { search } = useRouter();
  const report = useApi<SafetyReportDTO>(`/reports/${encodeURIComponent(id)}`);
  return (
    <Page
      title={t('rep.title')}
      actions={
        <Link to="/worker/reports" className="btn btn-secondary">
          {t('action.back')}
        </Link>
      }
    >
      {search.get('created') ? <Notice kind="success">{t('rep.submitted')}</Notice> : null}
      <Async state={report}>{(r) => <ReportDetail report={r} />}</Async>
    </Page>
  );
}
