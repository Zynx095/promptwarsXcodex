import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('./src/client', import.meta.url));

export default defineConfig({
  root: clientRoot,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
  },
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Integration tests seed a database and hash PINs with scrypt; 5 s timed out on a loaded machine.
    testTimeout: 20_000,
    environmentOptions: { happyDOM: { url: 'http://localhost/' } },
  },
});
