// @vitest-environment happy-dom
// Renders the real client against the real API for the final-update features: themes, offline
// check-in with the outbox, QR check-in, the pay check and the console's new pages.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import request from 'supertest';
import { setup, PHONES, type TestEnv } from '../integration/helpers';
import { App } from '../../src/client/App';
import { RouterProvider } from '../../src/client/lib/router';
import { I18nProvider } from '../../src/client/lib/i18n';
import { SessionProvider } from '../../src/client/lib/session';
import type { SiteDTO, SiteQrStateDTO } from '../../src/shared/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let env: TestEnv;
let root: Root;
let container: HTMLElement;
let consoleErrors: unknown[][];
const net = { offline: false };

async function render() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StrictMode>
        <I18nProvider>
          <RouterProvider>
            <SessionProvider>
              <App />
            </SessionProvider>
          </RouterProvider>
        </I18nProvider>
      </StrictMode>,
    );
  });
}

beforeEach(async () => {
  env = await setup();
  net.offline = false;
  const agent = request.agent(env.app);
  const fakeFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (net.offline) throw new TypeError('Failed to fetch');
    const method = (init.method ?? 'GET').toLowerCase() as 'get' | 'post' | 'put' | 'patch';
    let req = agent[method](String(input));
    if (init.headers) req = req.set(init.headers as Record<string, string>);
    const res = await (typeof init.body === 'string' ? req.send(init.body) : req);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
  };
  vi.stubGlobal('fetch', fakeFetch);
  window.fetch = fakeFetch as typeof window.fetch;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => !net.offline });
  window.scrollTo = () => undefined;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  document.documentElement.removeAttribute('data-theme');
  window.history.replaceState(null, '', '/');
  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
  container = document.createElement('div');
  document.body.innerHTML = '';
  document.body.appendChild(container);
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(consoleErrors.map((a) => a.map(String).join(' '))).toEqual([]);
});

const page = () => document.body.textContent ?? '';
async function waitFor(check: () => boolean, what: string, timeout = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for: ${what}\n--- page text ---\n${page().slice(0, 1500)}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}
const waitForText = (s: string) => waitFor(() => page().includes(s), `"${s}"`);
function findByText<T extends HTMLElement>(selector: string, label: string): T {
  const el = [...document.querySelectorAll<T>(selector)].find((e) => (e.textContent ?? '').trim().includes(label));
  if (!el) throw new Error(`No ${selector} with text "${label}"`);
  return el;
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  });
}
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function login(phone: string) {
  await waitForText('Sign in to FairShift');
  const labels = [...container.querySelectorAll('label')];
  const field = (l: string) =>
    document.getElementById(labels.find((x) => (x.textContent ?? '').trim().startsWith(l))!.getAttribute('for')!) as HTMLInputElement;
  await type(field('Phone number'), phone);
  await type(field('PIN'), '1234');
  await click(container.querySelector<HTMLButtonElement>('form button[type=submit]')!);
}
async function go(path: string) {
  await act(async () => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

describe('final update: client', () => {
  it('switches between Light, Dark and Night instantly and remembers the choice', async () => {
    await login(PHONES.lakshmi);
    await waitForText('Hello, Lakshmi Devi');
    for (const theme of ['night', 'dark', 'light'] as const) {
      await click(container.querySelector<HTMLButtonElement>('button[data-theme-picker]')!);
      await waitFor(() => document.querySelector(`input[name="theme"][value="${theme}"]`) !== null, 'theme sheet');
      await click(document.querySelector<HTMLInputElement>(`input[name="theme"][value="${theme}"]`)!);
      expect(document.documentElement.dataset.theme).toBe(theme);
      expect(localStorage.getItem('fairshift.theme')).toBe(theme);
      await click(document.querySelector<HTMLButtonElement>('.sheet-close')!);
    }
    // A new visit starts in the saved theme
    localStorage.setItem('fairshift.theme', 'night');
    await act(async () => root.unmount());
    await render();
    await waitForText('Hello, Lakshmi Devi');
    expect(document.documentElement.dataset.theme).toBe('night');
  });

  it('saves a check-in offline as pending verification and records it only when the server confirms', async () => {
    await login(PHONES.lakshmi);
    await waitForText('Not checked in today');
    net.offline = true;
    await click(findByText<HTMLButtonElement>('button', 'Check in'));
    await waitForText('Save check-in to send later');
    await click(findByText<HTMLButtonElement>('button', 'Save check-in to send later'));
    await waitForText('Check-in saved on this phone, pending verification');
    await waitForText('Check-in: Pending verification');
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    await waitForText('You are offline');
    const stored = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('fairshift.outbox.'))!)!);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'check-in', status: 'pending' });
    // Not recorded on the server yet
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_events WHERE action = 'check_in' AND after_json LIKE '%queuedOfflineAt%'`)!.n).toBe(
      0,
    );
    expect((await request(env.app).get('/healthz')).status).toBe(200);
    // While one is waiting, the offline time card offers no second save (the outbox also refuses one)
    await waitForText('Last known status: Not checked in today');
    expect(page()).not.toContain('Save check-in to send later');

    net.offline = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitForText('On shift now');
    const audit = env.ctx.db.get<{ after: string }>(
      `SELECT after_json AS after FROM audit_events WHERE action = 'check_in' AND after_json LIKE '%queuedOfflineAt%'`,
    )!;
    expect(JSON.parse(audit.after).queuedOfflineAtSource).toBe('device clock, unverified');
    const after = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('fairshift.outbox.'))!)!);
    expect(after[0].status).toBe('synced');
  });

  it('checks in by site QR after showing the worker which site it is', async () => {
    // The site screen, started from the console's API (inside act: the app is rendering meanwhile)
    let site!: SiteDTO;
    let qr!: SiteQrStateDTO;
    await act(async () => {
      const admin = request.agent(env.app);
      await admin.post('/api/auth/login').send({ phone: PHONES.constructionAdmin, pin: '1234' });
      site = ((await admin.get('/api/admin/sites')).body.items as SiteDTO[])[0]!;
      qr = (await admin.post(`/api/admin/sites/${site.id}/qr/start`).send({})).body as SiteQrStateDTO;
    });

    await login(PHONES.lakshmi);
    await waitForText('Hello, Lakshmi Devi');
    await go(`/c/${qr.token}`);
    await waitForText('Site verified');
    expect(page()).toContain(site.name);
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts WHERE site_id IS NOT NULL`)!.n).toBe(0);
    await click(findByText<HTMLButtonElement>('button', 'Check in here'));
    await waitForText(`Checked in at ${site.name}`);
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shifts WHERE site_id = @id`, { id: site.id })!.n).toBe(1);
    // Scanning the same code again is refused
    await go('/worker');
    await go(`/c/${qr.token}`);
    await waitForText('You already used this code');
  });

  it('shows the worker a pay check with the calculation, and the console records a payment', async () => {
    await login(PHONES.lakshmi);
    await waitForText('Hello, Lakshmi Devi');
    await click(findByText<HTMLAnchorElement>('nav a', 'Payslips'));
    await waitForText('Pay check');
    await waitForText('Expected earnings');
    expect(page()).toMatch(/No discrepancy identified|Possible shortfall|Payment discrepancy requires review/);
    expect(page()).toContain('not a legal finding');
    await click(findByText<HTMLButtonElement>('button', 'Sign out'));

    await login(PHONES.constructionAdmin);
    await waitForText('Workforce dashboard');
    await click(findByText<HTMLAnchorElement>('nav a', 'Pay check'));
    await waitForText('How the status is decided');
    await waitFor(() => document.querySelectorAll('tbody tr').length > 0, 'pay check rows');
    const before = env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM wage_payments`)!.n;
    await click(findByText<HTMLButtonElement>('button', 'Record payment'));
    await waitForText('Record a payment already made');
    const amount = [...document.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Amount'))!;
    await type(document.getElementById(amount.getAttribute('for')!) as HTMLInputElement, '250.50');
    await click(findByText<HTMLButtonElement>('form button[type=submit]', 'Record payment'));
    await waitForText('It is in the audit log');
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM wage_payments`)!.n).toBe(before + 1);
    expect(env.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM wage_payments WHERE amount_minor = 25050 AND method = 'bank_transfer'`)!.n).toBe(1);

    await click(findByText<HTMLAnchorElement>('nav a', 'Retention attention'));
    await waitForText('How the levels are worked out');
    expect(page()).toContain('not a prediction');
    await click(container.querySelector<HTMLButtonElement>('.retention-list button')!);
    await waitForText('retention attention');
  });
});
