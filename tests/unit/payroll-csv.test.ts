import { describe, expect, it } from 'vitest';
import { buildPayrollCsv, escapeCsvText, PAYROLL_CSV_HEADERS, type PayrollCsvRow } from '../../src/server/services/payrollCsv';

/** Minimal RFC 4180 parser so assertions look at cell values, not raw text. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const base: PayrollCsvRow = {
  id: 'ps_1',
  worker_id: 'usr_1',
  worker_name: 'Lakshmi Devi',
  phone: '9000000002',
  period_start: '2026-10-19',
  period_end: '2026-10-25',
  currency: 'INR',
  gross_pay_minor: 1234567,
  net_pay_minor: 1134567,
  issued_at: '2026-10-26T10:00:00.000Z',
  breakdown_json: JSON.stringify({ regularMinutes: 2400, overtimeMinutes: 95, basePayMinor: 1000000, overtimePayMinor: 234567, totalDeductionsMinor: 100000 }),
};

describe('Payroll CSV export', () => {
  it.each([
    ['=HYPERLINK("http://evil.example","x")'],
    ['+1+cmd|calc'],
    ['-2+3'],
    ['@SUM(A1:A2)'],
    ['\t=1+1'],
    ['\r=1+1'],
    ['\n=1+1'],
    ['   =1+1'],
    [' =1+1'],
    ['＝1+1'],
    ['\tplain'],
  ])('neutralises formula-like text %j with a leading apostrophe inside quotes', (payload) => {
    const cell = escapeCsvText(payload);
    expect(cell.startsWith(`"'`)).toBe(true);
    expect(parseCsv(cell)[0]![0]).toBe(`'${payload}`);
  });

  it('leaves ordinary text unchanged apart from quoting and escaped quotes', () => {
    expect(escapeCsvText('Ravi "RK" Kumar')).toBe('"Ravi ""RK"" Kumar"');
    expect(escapeCsvText('Anna-Marie')).toBe('"Anna-Marie"');
    expect(escapeCsvText(null)).toBe('""');
  });

  it('formats paise exactly, keeps column alignment and escapes every text column', () => {
    const csv = buildPayrollCsv([{ ...base, worker_name: "=cmd|' /C calc'!A0", currency: '@INR' }]);
    const [header, row] = parseCsv(csv);
    expect(header).toEqual([...PAYROLL_CSV_HEADERS]);
    expect(row).toHaveLength(PAYROLL_CSV_HEADERS.length);
    expect(row![2]).toBe("'=cmd|' /C calc'!A0");
    expect(row![6]).toBe("'@INR");
    expect(row!.slice(7, 14)).toEqual(['40.00', '1.58', '10000.00', '2345.67', '12345.67', '1000.00', '11345.67']);
  });

  it('keeps names with commas, quotes and newlines in a single cell', () => {
    const csv = buildPayrollCsv([{ ...base, worker_name: 'Kumar, Ravi\n"Site 2"' }]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]![2]).toBe('Kumar, Ravi\n"Site 2"');
  });

  it('exports zero detail columns rather than failing on malformed breakdown JSON', () => {
    for (const breakdown_json of ['not json', 'null', '"text"', JSON.stringify({ basePayMinor: -5, regularMinutes: 1.5 })]) {
      const [, row] = parseCsv(buildPayrollCsv([{ ...base, breakdown_json }]));
      expect(row!.slice(7, 11)).toEqual(['0.00', '0.00', '0.00', '0.00']);
      expect(row![11]).toBe('12345.67');
    }
  });

  it('handles large values without floating-point drift', () => {
    const big = 99_999_999_999; // ₹99.99 crore in paise
    const [, row] = parseCsv(buildPayrollCsv([{ ...base, gross_pay_minor: big, net_pay_minor: big - 1 }]));
    expect(row![11]).toBe('999999999.99');
    expect(row![13]).toBe('999999999.98');
  });
});

describe('Payroll CSV export endpoint', () => {
  it('rejects malformed date filters instead of echoing them into the download header', async () => {
    const { setup, PHONES } = await import('../integration/helpers');
    const env = await setup();
    const admin = await env.login(PHONES.constructionAdmin);
    for (const from of ['2026-13-40', '2026-10-01"; filename="x.exe', 'yesterday']) {
      const res = await admin.get('/api/admin/payslips/export.csv').query({ from });
      expect(res.status).toBe(400);
    }
    const ok = await admin.get('/api/admin/payslips/export.csv').query({ from: '2026-10-01', to: '2026-10-31' });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-disposition']).toBe('attachment; filename="fairshift_payroll_org_demo_construction_2026-10-01_2026-10-31.csv"');
  });
});
