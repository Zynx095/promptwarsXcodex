import { useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  Biohazard,
  ChevronRight,
  CircleHelp,
  Cog,
  Construction,
  EyeOff,
  FlaskConical,
  Footprints,
  HardHat,
  ShieldAlert,
  Siren,
  ThermometerSun,
  UserRound,
  Weight,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { useMe } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { Link, useRouter } from '../../lib/router';
import { formatDateTime } from '../../lib/format';
import { getIndustry } from '../../../shared/industries';
import { SEVERITIES, type SafetyReportDTO, type Severity } from '../../../shared/types';
import { Async, Button, Empty, ErrorBox, Field, Notice, Page, ReportStatusBadge } from '../../components/ui';
import { DictateButton } from '../../components/Voice';
import { ReportDetail } from '../../components/ReportDetail';
import { HeatSafetyWidget } from '../../components/HeatSafetyWidget';
import { LifecycleBar } from '../../components/Lifecycle';

const HAZARD_ICONS: Record<string, LucideIcon> = {
  fall: ArrowDownToLine,
  ppe: HardHat,
  electrical: Zap,
  machinery: Cog,
  scaffolding: Construction,
  heat: ThermometerSun,
  chemical: FlaskConical,
  slip: Footprints,
  waste: Biohazard,
  security: Siren,
  lifting: Weight,
  other: CircleHelp,
};

export function WorkerReports() {
  const { t, locale } = useI18n();
  const me = useMe();
  const mine = useApi<{ items: SafetyReportDTO[] }>('/reports/mine');
  return (
    <Page
      title={t('rep.title')}
      actions={
        <Link to="/worker/reports/new" className="btn btn-primary">
          <ShieldAlert className="icon" aria-hidden="true" />
          {t('rep.new')}
        </Link>
      }
    >
      <section aria-labelledby="rep-mine">
        <div className="section-head">
          <h2 id="rep-mine">{t('rep.mine')}</h2>
        </div>
        <Async state={mine}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty>{t('rep.none')}</Empty>
            ) : (
              <ul className="row-list">
                {d.items.map((r) => (
                  <li key={r.id}>
                    <Link to={`/worker/reports/${r.id}`} className="row-item report-row">
                      <span className="row-text">
                        <strong>{r.title}</strong>
                        <span className="report-row-status">
                          <ReportStatusBadge status={r.status} />
                          <LifecycleBar status={r.status} />
                        </span>
                        <span className="row-meta">
                          {t(`sev.${r.severity}`).split(' – ')[0]}, {formatDateTime(r.createdAt, me.org.timezone, locale)}
                          {r.confidential ? `, ${t('rep.confidentialShort')}` : ''}
                        </span>
                      </span>
                      <ChevronRight className="icon chevron" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </section>

      <section className="safety-tools">
        <HeatSafetyWidget />
      </section>
    </Page>
  );
}

type Identity = 'named' | 'confidential';

export function WorkerReportNew() {
  const { t, category } = useI18n();
  const me = useMe();
  const { navigate } = useRouter();
  const industry = getIndustry(me.org.industry);
  const [form, setForm] = useState({ category: '', severity: '' as Severity | '', title: '', location: '', description: '' });
  const [identity, setIdentity] = useState<Identity>('named');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const f = error?.fields ?? {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<SafetyReportDTO>('/reports', { method: 'POST', body: { ...form, confidential: identity === 'confidential' } });
      navigate(`/worker/reports/${created.id}?created=1`);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', t('common.error')));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t('rep.new')} description={t('rep.formIntro')}>
      <form className="step-form" onSubmit={submit} noValidate>
        <div ref={errorRef} tabIndex={-1} className="form-error-anchor">
          {error ? <ErrorBox error={error} /> : null}
        </div>

        <fieldset className={`form-step${f['category'] ? ' has-error' : ''}`}>
          <legend id="category-legend">{t('rep.category')}</legend>
          <div
            className="hazard-grid"
            role="radiogroup"
            aria-labelledby="category-legend"
            aria-invalid={f['category'] ? true : undefined}
            aria-describedby={f['category'] ? 'category-error' : undefined}
          >
            {industry.hazardCategories.map((c) => {
              const Icon = HAZARD_ICONS[c.key] ?? CircleHelp;
              return (
                <label key={c.key} className="check hazard-tile">
                  <input type="radio" name="category" value={c.key} checked={form.category === c.key} onChange={() => setForm({ ...form, category: c.key })} />
                  <Icon className="icon hazard-icon" aria-hidden="true" />
                  <span>{category('hazard', c.key, c.label)}</span>
                </label>
              );
            })}
          </div>
          {f['category'] ? (
            <p className="field-error" id="category-error">
              {f['category']}
            </p>
          ) : null}
        </fieldset>

        <fieldset className={`form-step${f['severity'] ? ' has-error' : ''}`}>
          <legend id="severity-legend">{t('rep.severity')}</legend>
          <div
            className="severity-list"
            role="radiogroup"
            aria-labelledby="severity-legend"
            aria-invalid={f['severity'] ? true : undefined}
            aria-describedby={f['severity'] ? 'severity-error' : undefined}
          >
            {SEVERITIES.map((s) => (
              <label key={s} className={`check severity-tile severity-${s}`}>
                <input type="radio" name="severity" value={s} checked={form.severity === s} onChange={() => setForm({ ...form, severity: s })} />
                <span>{t(`sev.${s}`)}</span>
              </label>
            ))}
          </div>
          {f['severity'] ? (
            <p className="field-error" id="severity-error">
              {f['severity']}
            </p>
          ) : null}
        </fieldset>

        <div className="form-step">
          <Field label={t('rep.titleField')} hint={t('rep.titleHint')} error={f['title']}>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />
          </Field>
          <Field label={t('rep.location')} error={f['location']}>
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={120} />
          </Field>
          <Field label={t('rep.description')} hint={t('rep.descriptionHint')} error={f['description']}>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={2000} />
          </Field>
          <DictateButton onText={(text) => setForm((p) => ({ ...p, description: `${p.description}${p.description ? ' ' : ''}${text}`.slice(0, 2000) }))} />
        </div>

        <fieldset className="form-step">
          <legend>{t('rep.identity')}</legend>
          <label className="check identity-tile">
            <input type="radio" name="identity" value="named" checked={identity === 'named'} onChange={() => setIdentity('named')} />
            <UserRound className="icon identity-icon" aria-hidden="true" />
            <span>
              <strong>{t('rep.named')}</strong>
              <span className="tile-hint">{t('rep.namedHint')}</span>
            </span>
          </label>
          <label className="check identity-tile">
            <input type="radio" name="identity" value="confidential" checked={identity === 'confidential'} onChange={() => setIdentity('confidential')} />
            <EyeOff className="icon identity-icon" aria-hidden="true" />
            <span>
              <strong>{t('rep.confidential')}</strong>
              <span className="tile-hint">{t('rep.confidentialHint')}</span>
            </span>
          </label>
        </fieldset>

        <div className="form-actions step-actions">
          <Button type="submit" busy={busy} className="btn btn-primary btn-big">
            {t('rep.send')}
          </Button>
          <Link to="/worker/reports" className="btn btn-quiet">
            {t('action.cancel')}
          </Link>
        </div>
      </form>
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
        <Link to="/worker/reports" className="btn btn-quiet">
          {t('action.back')}
        </Link>
      }
    >
      {search.get('created') ? <Notice kind="success">{t('rep.submitted')}</Notice> : null}
      <Async state={report}>{(r) => <ReportDetail report={r} />}</Async>
    </Page>
  );
}
