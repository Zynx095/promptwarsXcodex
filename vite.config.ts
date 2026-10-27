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
    environmentOptions: { happyDOM: { url: 'http://localhost/' } },
  },
});
