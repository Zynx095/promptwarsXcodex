// Service worker registration and the "new version available" prompt. The worker never takes
// over by itself: a new version waits until the person chooses to update, so nothing reloads
// in the middle of a check-in or a report.
import { useSyncExternalStore } from 'react';

let waiting: ServiceWorker | null = null;
let accepted = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setWaiting(worker: ServiceWorker | null) {
  waiting = worker;
  emit();
}

function watch(reg: ServiceWorkerRegistration) {
  if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    installing?.addEventListener('statechange', () => {
      // "installed" with an existing controller means an update, not the first install
      if (installing.state === 'installed' && navigator.serviceWorker.controller) setWaiting(installing);
    });
  });
}

/** Registers /sw.js in production builds. Returns false when it cannot or should not. */
export function registerServiceWorker(enabled: boolean = import.meta.env.PROD): boolean {
  if (!enabled || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Reload only for an update the person accepted, never on the first install
    if (accepted) window.location.reload();
  });
  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        watch(reg);
        const check = () => void reg.update().catch(() => undefined);
        window.setInterval(check, 60 * 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
      })
      .catch((err: unknown) => console.warn('Service worker registration failed', err));
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
  return true;
}

/** Activates the waiting version; the page reloads once it has taken over. */
export function applyUpdate(): void {
  if (!waiting) return;
  accepted = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export function dismissUpdate(): void {
  setWaiting(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => waiting !== null,
    () => false,
  );
}
