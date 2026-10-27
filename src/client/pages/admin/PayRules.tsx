// Pay and fatigue-rule configuration. Values are edited in friendly units (hours, ×, %, ₹)
// and converted to the stored integer units (minutes, basis points, paise).
import { useState, type FormEvent } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { parseMajorToMinor, minorToMajorString } from '../../../shared/money';
import type { DeductionKind, OrgSettings } from '../../../shared/types';
import { Async, Button, Card, ErrorBox, Field, Notice, Page } from '../../components/ui';

interface DeductionDraft {
  code: string;
  label: string;
  kind: DeductionKind;
  value: string;
}

interface Draft {
  scheduledHours: string;
  multiplier: string;
  deductions: DeductionDraft[];
  maxDailyHours: string;
  maxWeeklyHours: string;
  minRestHours: string;
  overtimeDaysPerWeek: string;
  requireSiteCode: boolean;
}

function toDraft(s: OrgSettings): Draft {
  return {
    scheduledHours: String(s.pay.scheduledDailyMinutes / 60),
    multiplier: String(s.pay.overtimeMultiplierBp / 10000),
    deductions: s.pay.deductions.map((d) => ({
      code: d.code,
      label: d.label,
      kind: d.kind,
      value: d.kind === 'fixed' ? minorToMajorString(d.value) : String(d.value / 100),
    })),
    maxDailyHours: String(s.fatigue.maxDailyMinutes / 60),
    maxWeeklyHours: String(s.fatigue.maxWeeklyMinutes / 60),
    minRestHours: String(s.fatigue.minRestMinutes / 60),
    overtimeDaysPerWeek: String(s.fatigue.overtimeDaysPerWeek),
    requireSiteCode: s.attendance.requireSiteCode,
  };
}

/** Converts the draft; returns field errors for values that are not numbers. */
function fromDraft(d: Draft): { settings?: OrgSettings; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const num = (key: string, v: string, scale: number) => {
    const n = Number(v);
    if (v.trim() === '' || !Number.isFinite(n) || n < 0) {
      errors[key] = 'Enter a number';
      return 0;
    }
    return Math.round(n * scale);
  };
  const deductions = d.deductions.map((x, i) => {
    let value = 0;
    if (x.kind === 'fixed') {
      const minor = parseMajorToMinor(x.value);
      if (minor === null) errors[`pay.deductions.${i}.value`] = 'Enter an amount like 50 or 50.00';
      value = minor ?? 0;
    } else value = num(`pay.deductions.${i}.value`, x.value, 100);
    return { code: x.code, label: x.label, kind: x.kind, value };
  });
  const settings: OrgSettings = {
    pay: {
      scheduledDailyMinutes: num('pay.scheduledDailyMinutes', d.scheduledHours, 60),
      overtimeMultiplierBp: num('pay.overtimeMultiplierBp', d.multiplier, 10000),
      deductions,
    },
    fatigue: {
      maxDailyMinutes: num('fatigue.maxDailyMinutes', d.maxDailyHours, 60),
      maxWeeklyMinutes: num('fatigue.maxWeeklyMinutes', d.maxWeeklyHours, 60),
      minRestMinutes: num('fatigue.minRestMinutes', d.minRestHours, 60),
      overtimeDaysPerWeek: num('fatigue.overtimeDaysPerWeek', d.overtimeDaysPerWeek, 1),
    },
    attendance: { requireSiteCode: d.requireSiteCode },
  };
  return Object.keys(errors).length ? { errors } : { settings, errors };
}

export function AdminPayRules() {
  const settings = useApi<OrgSettings>('/admin/settings');
  return (
    <Page title="Pay and working-hours rules">
      <Notice kind="info">
        These rules are set by your organisation. FairShift does not apply any country&apos;s employment law automatically; make sure your rules meet the laws
        and agreements that apply to you.
      </Notice>
      <Async state={settings}>{(s) => <RulesForm key={JSON.stringify(s)} initial={s} onSaved={settings.reload} />}</Async>
    </Page>
  );
}

function RulesForm({ initial, onSaved }: { initial: OrgSettings; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const setDed = (i: number, patch: Partial<DeductionDraft>) =>
    setDraft({ ...draft, deductions: draft.deductions.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const err = (k: string) => errors[k] ?? apiError?.fields[k];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setApiError(null);
    const { settings, errors: local } = fromDraft(draft);
    setErrors(local);
    if (!settings) return;
    setBusy(true);
    try {
      await api('/admin/settings', { method: 'PUT', body: settings });
      setSaved(true);
      onSaved();
    } catch (e2) {
      setApiError(e2 instanceof ApiError ? e2 : new ApiError(0, 'ERROR', 'Could not save.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      {apiError ? <ErrorBox error={apiError} /> : null}
      <Card title="Pay rules">
        <div className="form-row">
          <Field label="Scheduled hours per day" hint="Hours beyond this on one day are overtime." error={err('pay.scheduledDailyMinutes')}>
            <input inputMode="decimal" value={draft.scheduledHours} onChange={(e) => setDraft({ ...draft, scheduledHours: e.target.value })} />
          </Field>
          <Field label="Overtime multiplier" hint="For example 1.5 or 2 (times the hourly rate)." error={err('pay.overtimeMultiplierBp')}>
            <input inputMode="decimal" value={draft.multiplier} onChange={(e) => setDraft({ ...draft, multiplier: e.target.value })} />
          </Field>
        </div>
        <fieldset>
          <legend>Deductions</legend>
          {err('pay.deductions') ? <p className="field-error">{err('pay.deductions')}</p> : null}
          {draft.deductions.length === 0 ? <p className="muted">No deductions.</p> : null}
          {draft.deductions.map((d, i) => (
            <div key={i} className="form-row deduction-row">
              <Field label="Label" error={err(`pay.deductions.${i}.label`)}>
                <input value={d.label} onChange={(e) => setDed(i, { label: e.target.value })} />
              </Field>
              <Field label="Code" hint="Lowercase, e.g. pf" error={err(`pay.deductions.${i}.code`)}>
                <input value={d.code} onChange={(e) => setDed(i, { code: e.target.value })} />
              </Field>
              <Field label="Type">
                <select value={d.kind} onChange={(e) => setDed(i, { kind: e.target.value as DeductionKind })}>
                  <option value="percent_of_base">% of regular pay</option>
                  <option value="percent_of_gross">% of gross pay</option>
                  <option value="fixed">Fixed amount (₹)</option>
                </select>
              </Field>
              <Field label={d.kind === 'fixed' ? 'Amount (₹)' : 'Percent'} error={err(`pay.deductions.${i}.value`)}>
                <input inputMode="decimal" value={d.value} onChange={(e) => setDed(i, { value: e.target.value })} />
              </Field>
              <div className="field">
                <Button variant="secondary" onClick={() => setDraft({ ...draft, deductions: draft.deductions.filter((_, j) => j !== i) })}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="secondary"
            disabled={draft.deductions.length >= 8}
            onClick={() => setDraft({ ...draft, deductions: [...draft.deductions, { code: '', label: '', kind: 'percent_of_gross', value: '0' }] })}
          >
            Add deduction
          </Button>
        </fieldset>
      </Card>
      <Card title="Excessive-hours warning thresholds">
        <div className="form-row">
          <Field label="Max hours in a day" error={err('fatigue.maxDailyMinutes')}>
            <input inputMode="decimal" value={draft.maxDailyHours} onChange={(e) => setDraft({ ...draft, maxDailyHours: e.target.value })} />
          </Field>
          <Field label="Max hours in a week" error={err('fatigue.maxWeeklyMinutes')}>
            <input inputMode="decimal" value={draft.maxWeeklyHours} onChange={(e) => setDraft({ ...draft, maxWeeklyHours: e.target.value })} />
          </Field>
          <Field label="Min rest between shifts (hours)" error={err('fatigue.minRestMinutes')}>
            <input inputMode="decimal" value={draft.minRestHours} onChange={(e) => setDraft({ ...draft, minRestHours: e.target.value })} />
          </Field>
          <Field label="Overtime days per week before warning" error={err('fatigue.overtimeDaysPerWeek')}>
            <input inputMode="numeric" value={draft.overtimeDaysPerWeek} onChange={(e) => setDraft({ ...draft, overtimeDaysPerWeek: e.target.value })} />
          </Field>
        </div>
        <p className="muted small">New thresholds apply to shifts evaluated after saving (each check-out or correction). Existing alerts are kept.</p>
      </Card>
      <Card title="Check-in">
        <label className="check">
          <input type="checkbox" checked={draft.requireSiteCode} onChange={(e) => setDraft({ ...draft, requireSiteCode: e.target.checked })} />
          <span>
            <strong>Require the site check-in code</strong>
            <br />
            <span className="small muted">
              Workers must type the 6-digit code shown on the Shifts page (it changes every 5 minutes). This confirms they saw the current code at the
              workplace; it does not prove location, because a code can be passed on.
            </span>
          </span>
        </label>
      </Card>
      <div aria-live="polite">{saved ? <Notice kind="success">Rules saved. The change is recorded in the audit log.</Notice> : null}</div>
      <Button type="submit" busy={busy}>
        Save rules
      </Button>
    </form>
  );
}
