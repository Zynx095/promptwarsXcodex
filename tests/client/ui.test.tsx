// @vitest-environment happy-dom
// Renders the real React client against the real API (in-memory database) and walks the
// worker and admin journeys, failing on render errors or React warnings.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import request from 'supertest';
import { setup, PHONES, type TestEnv } from '../integration/helpers';
import { App } from '../../src/client/App';
import { RouterProvider } from '../../src/client/lib/router';
import { I18nProvider } from '../../src/client/lib/i18n';
import { SessionProvider } from '../../src/client/lib/session';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let env: TestEnv;
let root: Root;
let container: HTMLElement;
let consoleErrors: unknown[][];

beforeEach(async () => {
  env = await setup();
  const agent = request.agent(env.app);
  // Route the client's fetch calls into the Express app, keeping cookies like a browser.
  const fakeFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toLowerCase() as 'get' | 'post' | 'put' | 'patch';
    let req = agent[method](String(input));
    if (init.headers) req = req.set(init.headers as Record<string, string>);
    const res = await (typeof init.body === 'string' ? req.send(init.body) : req);
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'content-type': 'application/json' } });
  };
  vi.stubGlobal('fetch', fakeFetch);
  window.fetch = fakeFetch as typeof window.fetch;
  window.confirm = () => true;
  window.scrollTo = () => undefined;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  window.history.replaceState(null, '', '/');
  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
  container = document.createElement('div');
  document.body.innerHTML = '';
  document.body.appendChild(container);
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
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(consoleErrors.map((a) => a.map(String).join(' '))).toEqual([]);
});

const text = () => container.textContent ?? '';

async function waitFor(check: () => boolean, what: string, timeout = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for: ${what}\n--- page text ---\n${text().slice(0, 1500)}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}
const waitForText = (s: string) => waitFor(() => text().includes(s), `"${s}"`);

function findByText<T extends HTMLElement>(selector: string, label: string): T {
  const el = [...container.querySelectorAll<T>(selector)].find((e) => (e.textContent ?? '').trim().includes(label));
  if (!el) throw new Error(`No ${selector} with text "${label}"`);
  return el;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  });
}

function fieldByLabel(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const l = [...container.querySelectorAll('label')].find((x) => (x.textContent ?? '').trim().startsWith(label));
  const id = l?.getAttribute('for');
  const el = id ? (document.getElementById(id) as HTMLInputElement | null) : null;
  if (!el) throw new Error(`No field labelled "${label}"`);
  return el;
}

async function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement
      : el instanceof window.HTMLSelectElement
        ? window.HTMLSelectElement
        : window.HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

async function submit(button: string) {
  await click(findByText<HTMLButtonElement>('button', button));
}

async function nav(linkText: string) {
  await click(findByText<HTMLAnchorElement>('nav a', linkText));
}

async function login(phone: string) {
  await waitForText('Sign in to FairShift');
  await type(fieldByLabel('Phone number'), phone);
  await type(fieldByLabel('PIN'), '1234');
  await click(container.querySelector<HTMLButtonElement>('form button[type=submit]')!);
}

describe('web client', () => {
  it('worker journey: sign in, check in/out, payslip, hazard report, feedback, skills, Kannada', async () => {
    await waitForText('Synthetic demo accounts');
    await login(PHONES.lakshmi);
    await waitForText('Hello, Lakshmi Devi');
    expect(text()).toContain('synthetic sample data');
    expect(window.location.pathname).toBe('/worker');

    await waitForText('Not checked in today');
    await submit('Check in');
    await waitForText('On shift now');
    env.advance(600);
    await submit('Check out');
    await waitForText('Check out now?');
    await submit('Yes, check out');
    await waitForText('Shift recorded: 10h');
    await waitForText('Shift completed today');

    await nav('Attendance');
    await waitForText('Attendance history');
    await waitFor(() => container.querySelectorAll('tbody tr').length > 0, 'shift rows');

    await nav('Payslips');
    await waitForText('How this was calculated');
    expect(text()).toContain('Take-home pay');
    expect(text()).toContain('Overtime pay');
    expect(text()).toContain('Sample calculation from synthetic demo data');
    await waitFor(() => container.querySelectorAll('a[href^="/worker/payslips/"]').length > 0, 'issued payslip link');
    await click(container.querySelector<HTMLAnchorElement>('a[href^="/worker/payslips/"]')!);
    await waitForText('Issued');

    await nav('Safety reports');
    await click(findByText<HTMLAnchorElement>('a', 'Report a hazard'));
    await waitForText('What kind of hazard?');
    await submit('Send report');
    await waitForText('Some fields need attention.');
    expect(container.querySelectorAll('[role=radiogroup][aria-invalid="true"]')).toHaveLength(2);
    expect(container.querySelector('input[aria-invalid="true"]')).not.toBeNull();
    await click(container.querySelector<HTMLInputElement>('input[name=category][value=electrical]')!);
    await click(container.querySelector<HTMLInputElement>('input[name=severity][value=high]')!);
    await type(fieldByLabel('Short title'), 'Broken switchboard cover');
    await type(fieldByLabel('Where is it?'), 'Tower A ground floor');
    await type(fieldByLabel('Describe the hazard'), 'The switchboard cover is cracked and live parts are exposed.');
    await submit('Send report');
    await waitForText('Report sent');
    await waitForText('Reported – not yet reviewed');

    await nav('Feedback');
    await waitForText('How your privacy is protected');
    await click(container.querySelector<HTMLInputElement>('input[name="topic"][value="facilities"]')!);
    await click(container.querySelector<HTMLInputElement>('input[name="rating"][value="2"]')!);
    expect(container.querySelector<HTMLInputElement>('input[name="topic"][value="facilities"]')!.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="rating"][value="2"]')!.checked).toBe(true);
    await submit('Send feedback');
    await waitForText('sent without your name');
    expect(container.querySelector<HTMLInputElement>('input[name="topic"]:checked')).toBeNull();

    await nav('Skill passport');
    await waitForText('Self-reported');
    await type(fieldByLabel('Name'), 'Shuttering work');
    await submit('Save');
    await waitForText('Entry added as self-reported');
    await waitForText('Shuttering work');

    await click(container.querySelector<HTMLButtonElement>('button[data-lang-picker]')!);
    await waitFor(() => container.querySelector('input[name="language"][value="kn"]') !== null, 'language sheet');
    await click(container.querySelector<HTMLInputElement>('input[name="language"][value="kn"]')!);
    await waitForText('ಹಾಜರಾತಿ');
    expect(window.location.pathname).toBe('/worker/skills');
    expect(container.querySelector('input[name="language"]')).toBeNull();
    expect(document.documentElement.lang).toBe('kn');

    await submit('ಸೈನ್ ಔಟ್');
    await waitFor(() => text().includes('FairShift ಗೆ ಸೈನ್ ಇನ್ ಮಾಡಿ'), 'login page in Kannada');
  });

  it('admin journey: dashboard, every admin page, report resolution and shift correction', async () => {
    await login(PHONES.constructionAdmin);
    await waitForText('Workforce dashboard');
    await waitForText('Unresolved hazard reports');
    expect(text()).toContain('synthetic demonstration records');

    for (const [link, heading] of [
      ['Workforce', 'Mohammed Irfan'],
      ['Retention attention', 'How the levels are worked out'],
      ['Sites & QR check-in', 'Sites & QR check-in'],
      ['Hours alerts', 'Long working day'],
      ['Payslips', 'Issued payslips'],
      ['Pay check', 'How the status is decided'],
      ['Pay & hours rules', 'Overtime multiplier'],
      ['Feedback', 'Responses'],
      ['Audit log', 'check in'],
    ] as const) {
      await nav(link);
      await waitForText(heading);
    }

    await nav('Shifts');
    // Console pages load on demand: wait for the page, as the loop above does for the others
    await waitForText('Shift and attendance records');
    await type(fieldByLabel('Status'), 'completed');
    await submit('Filter');
    await waitFor(() => window.location.search.includes('status=completed') && container.querySelectorAll('tbody tr').length > 0, 'completed shift rows');
    await waitFor(() => !text().includes('On shift—'), 'completed rows only');
    await click(findByText<HTMLButtonElement>('button', 'Correct'));
    await waitForText('Reason for correction');
    await type(fieldByLabel('Reason for correction'), 'Confirmed with supervisor: left 15 minutes early.');
    const out = fieldByLabel('Check-out') as HTMLInputElement;
    expect(out.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const d = new Date(`${out.value}:00Z`);
    d.setUTCMinutes(d.getUTCMinutes() - 15);
    await type(out, d.toISOString().slice(0, 16));
    await submit('Save correction');
    await waitForText('corrected. The change is recorded in the audit log');

    await nav('Safety reports');
    await waitForText('Not enough helmets for helpers');
    await click(findByText<HTMLAnchorElement>('a', 'Not enough helmets for helpers'));
    await waitForText('Reporter identity protected');
    expect(text()).not.toContain('Lakshmi');
    await submit('Acknowledge');
    await waitForText('Report updated');
    await waitFor(() => text().includes('Seen by employer'), 'acknowledged status');
    await click(container.querySelector<HTMLInputElement>('input[name=to][value=resolved]')!);
    await submit('Mark resolved');
    await waitForText('Add a note explaining why the report is being resolved.');
    await type(fieldByLabel('Note (required)'), 'Twenty new helmets issued from store.');
    await submit('Mark resolved');
    await waitFor(() => text().includes('Marked fixed by employer'), 'resolved status');

    await nav('Dashboard');
    await waitForText('Recent activity');
  });

  it('shows a not-allowed message when a worker opens an admin URL', async () => {
    await login(PHONES.manjula);
    await waitForText('Hello, Manjula S');
    expect(text()).toContain('Educational institution');
    await act(async () => {
      window.history.pushState(null, '', '/admin/payslips');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitForText('You do not have access to this page.');
  });
});
