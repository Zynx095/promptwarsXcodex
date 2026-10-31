// Produces a Vercel Build Output API v3 directory (.vercel/output) from the normal build:
//   static/                 the Vite client (dist/client)
//   functions/api.func/     the Express API bundled into one ESM file
// Deploy with: npx vercel deploy --prebuilt --prod
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const out = '.vercel/output';
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/functions/api.func`, { recursive: true });

cpSync('dist/client', `${out}/static`, { recursive: true });

await build({
  entryPoints: ['src/server/vercel.ts'],
  outfile: `${out}/functions/api.func/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Bundled CommonJS dependencies (Express) still call require() for Node built-ins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});

writeFileSync(
  `${out}/functions/api.func/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 10 }, null, 2),
);

writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/api/(.*)', dest: '/api' },
        { src: '/healthz', dest: '/api' },
        { handle: 'filesystem' },
        { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        // The service worker and its shell files must be revalidated, so a new release is noticed
        { src: '/(sw\\.js|manifest\\.webmanifest|theme-init\\.js|offline\\.html)', headers: { 'cache-control': 'no-cache' }, continue: true },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log(`Vercel build output written to ${out}`);
