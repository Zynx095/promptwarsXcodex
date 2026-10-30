// Payroll CSV export. Money is converted from integer paise with exact string formatting, and every
// text cell is quoted and neutralised against spreadsheet formula injection (CWE-1236).
import { minorToMajorString } from '../../shared/money';

export interface PayrollCsvRow {
  id: string;
  worker_id: string;
  worker_name: string;
  phone: string;
  period_start: string;
  period_end: string;
  currency: string;
  gross_pay_minor: number;
  net_pay_minor: number;
  issued_at: string;
  breakdown_json: string;
}

export const PAYROLL_CSV_HEADERS = [
  'Payslip ID',
  'Worker ID',
  'Worker Name',
  'Phone',
  'Period Start',
  'Period End',
  'Currency',
  'Regular Hours',
  'Overtime Hours',
  'Base Pay',
  'Overtime Pay',
  'Gross Pay',
  'Deductions',
  'Net Pay',
  'Issued At',
] as const;

// Characters that make Excel, LibreOffice or Google Sheets treat a cell as a formula or DDE call,
// including their full-width forms. Leading whitespace is skipped first, because some spreadsheet
// imports trim it before deciding whether a cell is a formula.
const FORMULA_START = /^\s*[=+\-@＝＋－＠]/;
const LEADING_CONTROL = /^[\t\r\n]/;

/** Quotes a text cell and prefixes an apostrophe when it could be interpreted as a formula. */
export function escapeCsvText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  const safe = FORMULA_START.test(str) || LEADING_CONTROL.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

function hours(minutes: number): string {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2);
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Builds the CSV body. Malformed breakdown JSON yields zero detail columns, never a failed export. */
export function buildPayrollCsv(rows: PayrollCsvRow[]): string {
  const lines = rows.map((s) => {
    let b: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(s.breakdown_json);
      if (parsed && typeof parsed === 'object') b = parsed as Record<string, unknown>;
    } catch {
      b = {};
    }
    return [
      escapeCsvText(s.id),
      escapeCsvText(s.worker_id),
      escapeCsvText(s.worker_name),
      escapeCsvText(s.phone),
      escapeCsvText(s.period_start),
      escapeCsvText(s.period_end),
      escapeCsvText(s.currency),
      hours(nonNegativeInt(b.regularMinutes)),
      hours(nonNegativeInt(b.overtimeMinutes)),
      minorToMajorString(nonNegativeInt(b.basePayMinor)),
      minorToMajorString(nonNegativeInt(b.overtimePayMinor)),
      minorToMajorString(s.gross_pay_minor),
      minorToMajorString(nonNegativeInt(b.totalDeductionsMinor)),
      minorToMajorString(s.net_pay_minor),
      escapeCsvText(s.issued_at),
    ].join(',');
  });
  return [PAYROLL_CSV_HEADERS.join(','), ...lines].join('\r\n');
}
