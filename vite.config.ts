import { defineConfig } from 'vite';
import { injectHead } from './pipeline/inject-head.mjs';

export default defineConfig({
  appType: 'spa',
  plugins: [{ name: 'site-head', transformIndexHtml: html => injectHead(html) }],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
