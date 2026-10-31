// Build step for the service worker: fills the template in sw.js with this build's ID and the
// application-shell files (the entry script, its static imports and its styles), and writes it to
// dist/client/sw.js. Development (vite dev server) registers no service worker.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Static files from public/ that belong to the shell. */
export const STATIC_SHELL = ['/index.html', '/offline.html', '/manifest.webmanifest', '/theme-init.js', '/icons/icon-192.png', '/icons/icon-512.png'];

export const SW_TEMPLATE_PATH = fileURLToPath(new URL('./sw.js', import.meta.url));

/** Returns the service worker source for a build. */
export function renderServiceWorker(template: string, precache: string[]): { source: string; buildId: string } {
  const urls = [...new Set(precache)].sort();
  const buildId = createHash('sha256').update(urls.join('|')).digest('hex').slice(0, 12);
  const source = template
    .replace(/\/\* __FAIRSHIFT_BUILD_ID__ \*\/ '[^']*'/, `'${buildId}'`)
    .replace(/\/\* __FAIRSHIFT_PRECACHE__ \*\/ \[[^\]]*\]/, JSON.stringify(urls));
  return { source, buildId };
}

export function serviceWorkerPlugin(): Plugin {
  return {
    name: 'fairshift-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const urls = new Set(STATIC_SHELL);
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk' || !file.isEntry) continue;
        urls.add(`/${file.fileName}`);
        for (const imported of file.imports) urls.add(`/${imported}`);
        const css = (file as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss;
        for (const c of css ?? []) urls.add(`/${c}`);
      }
      const { source } = renderServiceWorker(readFileSync(SW_TEMPLATE_PATH, 'utf8'), [...urls]);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
