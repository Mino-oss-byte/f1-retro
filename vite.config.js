import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the build works from any static host or sub-folder (e.g. GitHub Pages)
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
});
