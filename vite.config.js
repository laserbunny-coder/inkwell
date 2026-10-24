import { defineConfig } from 'vite';

// Relative paths so the built app works from any folder, including GitHub Pages.
// Two pages: the app, and read.html, which a share link opens.
export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { index: 'index.html', read: 'read.html' } } }
});
