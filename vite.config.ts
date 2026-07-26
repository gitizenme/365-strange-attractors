import { defineConfig } from 'vite';
import { injectHead } from './pipeline/inject-head.mjs';

// Bundle names are content-hashed so a deploy changes asset URLs — the host
// (GitHub Pages) pins Cache-Control: max-age=600, and iOS Safari may serve a
// cached subresource forever without revalidating, so stable URLs pin stale
// code. Pipeline HTML shells reference the placeholder names /assets/app.js +
// /assets/index.css and are rewritten to the hashed names by pipeline/stamp.mjs
// (`npm run build` stamps dist/; the CI deploy restamps the deploy repo).
// __BUILD_ID__ gives runtime data fetches the same per-deploy cache miss
// (see dataUrl in src/data.ts).
export default defineConfig({
  appType: 'spa',
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  plugins: [{ name: 'site-head', transformIndexHtml: html => injectHead(html) }],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
