import { defineConfig } from 'vite';
import { QUERIES } from './src/device.js';

// The CSS asks about the device with custom media, `@media (--touch)`, and
// this swaps each for its query in src/device.js, the same one the JS asks.
// An unknown name stops the build, so a typo can't quietly match nothing.
const deviceMedia = () => ({
  name: 'inkwell-device-media',
  enforce: 'pre',
  transform(code, id) {
    if (!/\.css($|\?)/.test(id) || !code.includes('(--')) return null;
    return code.replace(/@media[^{;]*/g, (prelude) => prelude.replace(/\(--([a-z]+)\)/g, (_, name) => {
      if (!QUERIES[name]) throw new Error(`${id}: no device question called --${name} (see src/device.js)`);
      return QUERIES[name];
    }));
  }
});

// Relative paths so the built app works from any folder, including GitHub Pages.
// Three pages: the app, read.html (which a share link opens) and save.html
// (the little window the Save to Inkwell bookmark opens).
export default defineConfig({
  base: './',
  plugins: [deviceMedia()],
  build: { rollupOptions: { input: { index: 'index.html', read: 'read.html', save: 'save.html' } } }
});
