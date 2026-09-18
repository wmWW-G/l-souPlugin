import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: 'frontend', publicDir: false,
  build: { outDir: '../dist', emptyOutDir: true },
  server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:8787' } },
  resolve: { alias: { '@project': resolve('.') } },
});
