import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'spa',
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
