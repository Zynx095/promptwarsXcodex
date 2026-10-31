// Reusable presentational building blocks. Styling lives in styles.css.
import { useId, useRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode, type Ref, cloneElement } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { useI18n, useMoney } from '../lib/i18n';
import type { ApiError } from '../lib/api';
import type { ReportStatus, Severity } from '../../shared/types';
import { Sheet } from './Sheet';

export function Page({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {description ? <p className="lead">{description}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
      {children}
    </>
  );
}

export function Card({ title, subtitle, children, className }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {title ? <h2 className="card-title">{title}</h2> : null}
      {subtitle ? <p className="card-sub">{subtitle}</p> : null}
      {children}
    </section>
  );
}

export function Button({
  variant = 'primary',
  busy,
  children,
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'link' | 'quiet';
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button ref={ref} type="button" className={`btn btn-${variant}`} disabled={busy || rest.disabled} aria-busy={busy || undefined} {...rest}>
      {children}
    </button>
  );
}

/** Labelled form control with hint and error, wired up with aria attributes. */
export function Field({
  label,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const { t } = useI18n();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {optional ? <span className="optional"> ({t('common.optional')})</span> : null}
      </label>
      {hint ? (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined,
      })}
      {error ? (
        <p className="field-error" id={errId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Skeleton({ className = '', height, width }: { className?: string; height?: string | number; width?: string | number }) {
  return <div className={`skeleton-shimmer ${className}`} style={{ height, width }} aria-hidden="true" />;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Focus starts on the safer choice so Enter does not confirm by accident.
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Sheet open={isOpen} onClose={onCancel} title={title} role="alertdialog" initialFocus={cancelRef} dismissible={!busy}>
      <div className="dialog-message">{message}</div>
      <div className="dialog-actions">
        <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={variant} onClick={onConfirm} busy={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <div className="skeleton-grid" aria-hidden="true">
        <Skeleton height={28} width="50%" className="mb-3" />
        <Skeleton height={18} width="80%" className="mb-2" />
        <Skeleton height={18} width="65%" className="mb-4" />
        <div className="stats mb-3">
          <Skeleton height={74} width="100%" />
          <Skeleton height={74} width="100%" />
        </div>
      </div>
      <span className="visually-hidden">{t('common.loading')}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | string; onRetry?: () => void }) {
  const { t } = useI18n();
  const message = typeof error === 'string' ? error : error.message || t('common.error');
  return (
    <div className="alert alert-error" role="alert">
      <AlertCircle className="icon" aria-hidden="true" />
      <p>{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

const NOTICE_ICONS = {
  info: <Info className="icon" aria-hidden="true" />,
  success: <CheckCircle2 className="icon" aria-hidden="true" />,
  warning: <TriangleAlert className="icon" aria-hidden="true" />,
};

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'success' | 'warning'; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'success' ? 'status' : undefined}>
      {NOTICE_ICONS[kind]}
      <div>{children}</div>
    </div>
  );
}

/** An empty state says what is missing and, where possible, offers the next step. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  if (!action) return <p className="state state-empty">{children}</p>;
  return (
    <div className="state state-empty">
      <p className="m-0">{children}</p>
      <div className="mt-3">{action}</div>
    </div>
  );
}

/** Renders loading / error / content for a useApi result. */
export function Async<T>({
  state,
  children,
}: {
  state: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void };
  children: (data: T) => ReactNode;
}) {
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (state.data === null) return <Loading />;
  return <>{children(state.data)}</>;
}

export function Money({ minor, currency = 'INR' }: { minor: number; currency?: string }) {
  const money = useMoney();
  return <span className="money">{money(minor, currency)}</span>;
}

export function Badge({ tone, children }: { tone: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<ReportStatus, 'neutral' | 'good' | 'warn' | 'bad' | 'info'> = {
  submitted: 'warn',
  acknowledged: 'info',
  in_progress: 'info',
  resolved: 'good',
  follow_up_pending: 'warn',
  outcome_verified: 'good',
  reopened: 'bad',
};

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;
}

const SEVERITY_TONE: Record<Severity, 'neutral' | 'warn' | 'bad'> = { low: 'neutral', medium: 'warn', high: 'bad', critical: 'bad' };

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useI18n();
  return <Badge tone={SEVERITY_TONE[severity]}>{t(`sev.${severity}`).split(' – ')[0]}</Badge>;
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <Button variant="secondary" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Previous
      </Button>
      <span>
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <Button variant="secondary" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Next
      </Button>
    </nav>
  );
}

export interface BarDatum {
  label: string;
  /** Full label for screen readers and tooltips. */
  title: string;
  value: number;
  /** Optional stacked value drawn on top in amber (e.g. overtime). */
  extra?: number;
}

/** Dependency-free bar chart with a visually hidden data table for screen readers. */
export function BarChart({
  data,
  caption,
  valueLabel,
  extraLabel,
  format = String,
}: {
  data: BarDatum[];
  caption: string;
  valueLabel: string;
  extraLabel?: string;
  format?: (n: number) => string;
}) {
  const peak = Math.max(0, ...data.map((d) => d.value + (d.extra ?? 0)));
  const max = Math.max(1, peak) * 1.1;
  const pct = (n: number) => `${(n / max) * 100}%`;
  return (
    <figure className="chart">
      <div className="chart-bars" aria-hidden="true">
        {peak > 0 ? (
          <div className="chart-peak" style={{ bottom: pct(peak) }}>
            <span>{format(peak)}</span>
          </div>
        ) : null}
        {data.map((d) => (
          <div key={d.title} className="chart-col" title={`${d.title}: ${format(d.value)}${extraLabel ? `, ${extraLabel}: ${format(d.extra ?? 0)}` : ''}`}>
            {d.extra ? <div className="chart-bar extra" style={{ height: pct(d.extra) }} /> : null}
            <div className="chart-bar" style={{ height: pct(d.value) }} />
          </div>
        ))}
      </div>
      <div className="chart-labels" aria-hidden="true">
        {data.map((d, i) => (
          <span key={d.title}>{data.length > 16 && i % 2 ? '' : d.label}</span>
        ))}
      </div>
      <figcaption className="chart-legend">
        <span>{valueLabel}</span>
        {extraLabel ? <span className="legend-extra">{extraLabel}</span> : null}
      </figcaption>
      <div className="visually-hidden">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">{valueLabel}</th>
              {extraLabel ? <th scope="col">{extraLabel}</th> : null}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.title}>
                <th scope="row">{d.title}</th>
                <td>{format(d.value)}</td>
                {extraLabel ? <td>{format(d.extra ?? 0)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
