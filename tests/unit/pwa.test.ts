// Installable app and offline shell: the manifest, the icons, and the service worker's caching
// rules, run in a simulated service worker scope (no browser needed).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderServiceWorker, STATIC_SHELL, SW_TEMPLATE_PATH } from '../../src/client/pwa/plugin';

const client = resolve(import.meta.dirname, '../../src/client');
const pub = resolve(client, 'public');
const ORIGIN = 'https://fairshift.test';

function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe('web app manifest', () => {
  const manifest = JSON.parse(readFileSync(resolve(pub, 'manifest.webmanifest'), 'utf8'));
  const html = readFileSync(resolve(client, 'index.html'), 'utf8');

  it('is installable: name, standalone display, start URL in scope, colours and icons', () => {
    expect(manifest).toMatchObject({ name: 'FairShift', short_name: 'FairShift', display: 'standalone', scope: '/', id: '/' });
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    expect(manifest.theme_color).toBe('#3a0f34');
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/);
    const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  });

  it('points at real PNG icons of the declared sizes', () => {
    for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
      const file = resolve(pub, `.${icon.src}`);
      expect(existsSync(file), icon.src).toBe(true);
      expect(icon.type).toBe('image/png');
      const { width, height } = pngSize(file);
      expect(`${width}x${height}`).toBe(icon.sizes);
    }
    expect(pngSize(resolve(pub, 'icons/apple-touch-icon.png'))).toEqual({ width: 180, height: 180 });
  });

  it('is linked from the page, with the theme applied before the app script', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(html).toMatch(/<meta name="theme-color" content="#3a0f34" \/>/);
    expect(html.indexOf('/theme-init.js')).toBeGreaterThan(-1);
    expect(html.indexOf('/theme-init.js')).toBeLessThan(html.indexOf('./main.tsx'));
    // The shortcuts open worker screens inside the app scope
    for (const s of manifest.shortcuts as { url: string }[]) expect(s.url.startsWith('/worker/')).toBe(true);
  });

  it('has a self-contained offline page that loads nothing from other origins', () => {
    const offline = readFileSync(resolve(pub, 'offline.html'), 'utf8');
    expect(offline).toContain('You are offline');
    expect(offline).not.toMatch(/(src|href)="https?:\/\//);
    expect(offline).toContain('<script src="/theme-init.js"></script>');
  });
});

/** Runs the service worker in a fake scope with an in-memory Cache Storage. */
function bootServiceWorker(precache = [...STATIC_SHELL, '/assets/index-abc123.js']) {
  const { source, buildId } = renderServiceWorker(readFileSync(SW_TEMPLATE_PATH, 'utf8'), precache);
  const listeners: Record<string, (e: unknown) => void> = {};
  const store = new Map<string, Map<string, Response>>();
  const path = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;
  const network = { online: true, requests: [] as string[] };
  // Response objects with type "basic", as a browser gives for same-origin requests
  const BasicResponse = class extends Response {
    override get type(): ResponseType {
      return 'basic';
    }
  };
  const fetchImpl = vi.fn(async (r: string | { url: string }) => {
    network.requests.push(path(r));
    if (!network.online) throw new TypeError('Failed to fetch');
    return new BasicResponse(`body of ${path(r)}`, { status: 200 });
  });
  const cacheFor = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const c = store.get(name)!;
    return {
      addAll: async (urls: string[]) => {
        for (const u of urls) c.set(u, await fetchImpl(u));
      },
      put: async (r: string | { url: string }, res: Response) => void c.set(path(r), res),
      match: async (r: string | { url: string }) => c.get(path(r))?.clone(),
    };
  };
  const caches = {
    open: async (name: string) => cacheFor(name),
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (r: string | { url: string }) => {
      for (const c of store.values()) if (c.has(path(r))) return c.get(path(r))!.clone();
      return undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(),
  };
  vm.runInNewContext(source, { self, caches, fetch: fetchImpl, URL, Response, Promise, console });

  async function lifecycle(type: 'install' | 'activate') {
    const waits: Promise<unknown>[] = [];
    listeners[type]!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  async function request(url: string, mode: 'navigate' | 'cors' = 'cors', method = 'GET') {
    let responded: Promise<Response> | undefined;
    listeners.fetch!({ request: { url: new URL(url, ORIGIN).href, method, mode }, respondWith: (p: Promise<Response>) => (responded = p) });
    return responded ? await responded : undefined;
  }
  return { buildId, store, network, self, lifecycle, request, listeners };
}

describe('service worker', () => {
  it('gets a build ID and precache list from the build, so each release is a new version', () => {
    const a = renderServiceWorker(readFileSync(SW_TEMPLATE_PATH, 'utf8'), ['/index.html', '/assets/a.js']);
    const b = renderServiceWorker(readFileSync(SW_TEMPLATE_PATH, 'utf8'), ['/index.html', '/assets/b.js']);
    expect(a.buildId).not.toBe(b.buildId);
    expect(a.source).toContain(`const BUILD_ID = '${a.buildId}';`);
    expect(a.source).toContain('const PRECACHE = ["/assets/a.js","/index.html"];');
    expect(a.source).not.toContain('__FAIRSHIFT_');
  });

  it('caches the application shell on install and removes older versions on activate', async () => {
    const sw = bootServiceWorker();
    sw.store.set('fairshift-shell-old', new Map());
    await sw.lifecycle('install');
    const shell = sw.store.get(`fairshift-shell-${sw.buildId}`)!;
    expect([...shell.keys()]).toEqual(expect.arrayContaining(['/index.html', '/offline.html', '/assets/index-abc123.js', '/manifest.webmanifest']));
    // It waits for the page to accept the update instead of taking over by itself
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    await sw.lifecycle('activate');
    expect(sw.store.has('fairshift-shell-old')).toBe(false);
    expect(sw.self.clients.claim).toHaveBeenCalled();
    sw.listeners.message!({ data: { type: 'SKIP_WAITING' } });
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it('never intercepts or caches the API: records, sessions and passkey challenges', async () => {
    const sw = bootServiceWorker();
    await sw.lifecycle('install');
    for (const url of ['/api/auth/me', '/api/payslips', '/api/attendance/passkey-options', '/api/admin/pay-check', '/healthz']) {
      expect(await sw.request(url)).toBeUndefined();
    }
    expect(await sw.request('/api/attendance/check-in', 'cors', 'POST')).toBeUndefined();
    for (const cache of sw.store.values()) for (const key of cache.keys()) expect(key.startsWith('/api')).toBe(false);
  });

  it('serves pages from the network, falling back to the cached shell and then the offline page', async () => {
    const sw = bootServiceWorker();
    await sw.lifecycle('install');
    expect(await (await sw.request('/worker/attendance', 'navigate'))!.text()).toBe('body of /worker/attendance');
    sw.network.online = false;
    expect(await (await sw.request('/worker/attendance', 'navigate'))!.text()).toBe('body of /index.html');
    sw.store.get(`fairshift-shell-${sw.buildId}`)!.delete('/index.html');
    expect(await (await sw.request('/worker', 'navigate'))!.text()).toBe('body of /offline.html');
  });

  it('serves hashed assets cache-first and stores new ones for offline use', async () => {
    const sw = bootServiceWorker();
    await sw.lifecycle('install');
    const before = sw.network.requests.length;
    await sw.request('/assets/index-abc123.js');
    expect(sw.network.requests.length).toBe(before);
    await sw.request('/assets/Admin-xyz.js');
    await new Promise((r) => setTimeout(r, 0));
    expect(sw.store.get('fairshift-assets-v1')?.has('/assets/Admin-xyz.js')).toBe(true);
    sw.network.online = false;
    expect(await (await sw.request('/assets/Admin-xyz.js'))!.text()).toBe('body of /assets/Admin-xyz.js');
  });

  it('ignores other origins and non-GET requests', async () => {
    const sw = bootServiceWorker();
    expect(await sw.request('https://elsewhere.example/x.js')).toBeUndefined();
    expect(await sw.request('/assets/a.js', 'cors', 'POST')).toBeUndefined();
  });
});
