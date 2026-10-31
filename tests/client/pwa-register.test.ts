// @vitest-environment happy-dom
// Service worker registration and the update prompt, with a fake navigator.serviceWorker.
import { afterEach, describe, expect, it, vi } from 'vitest';

function fakeServiceWorker(reg: Partial<ServiceWorkerRegistration>, controller: object | null) {
  const listeners: Record<string, () => void> = {};
  const container = {
    controller,
    register: vi.fn(async () => reg as ServiceWorkerRegistration),
    addEventListener: (type: string, fn: () => void) => (listeners[type] = fn),
  };
  Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: container });
  return { container, listeners };
}

afterEach(() => {
  vi.resetModules();
  Reflect.deleteProperty(window.navigator, 'serviceWorker');
});

describe('service worker registration', () => {
  it('does nothing in development or where service workers are unsupported', async () => {
    const { registerServiceWorker } = await import('../../src/client/lib/pwa');
    expect(registerServiceWorker(false)).toBe(false);
    expect(registerServiceWorker(true)).toBe(false); // no navigator.serviceWorker here
  });

  it('registers /sw.js for the whole app and offers a waiting update without forcing it', async () => {
    const waiting = { postMessage: vi.fn() };
    const reg = { waiting, addEventListener: vi.fn(), update: vi.fn(async () => undefined) } as unknown as ServiceWorkerRegistration;
    const { container, listeners } = fakeServiceWorker(reg, {});
    const pwa = await import('../../src/client/lib/pwa');
    expect(pwa.registerServiceWorker(true)).toBe(true);
    await vi.waitFor(() => expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' }));
    await Promise.resolve();
    // The waiting version only takes over when the person accepts
    expect(waiting.postMessage).not.toHaveBeenCalled();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
    listeners.controllerchange!();
    expect(reload).not.toHaveBeenCalled();
    pwa.applyUpdate();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    listeners.controllerchange!();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('treats the very first install as no update', async () => {
    const reg = { waiting: { postMessage: vi.fn() }, addEventListener: vi.fn(), update: vi.fn(async () => undefined) } as unknown as ServiceWorkerRegistration;
    fakeServiceWorker(reg, null);
    const pwa = await import('../../src/client/lib/pwa');
    pwa.registerServiceWorker(true);
    await new Promise((r) => setTimeout(r, 0));
    pwa.applyUpdate();
    expect((reg.waiting as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).not.toHaveBeenCalled();
  });
});
