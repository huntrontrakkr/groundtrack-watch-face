import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
// Satellite.js 7 also exports optional WASM workers. Vite visits those modules
// before tree-shaking; their top-level await needs ES-format worker output.
export default defineConfig({base:'./',worker:{format:'es'},build:{rollupOptions:{input:{atlas:fileURLToPath(new URL('./index.html',import.meta.url)),art:fileURLToPath(new URL('./study-02.html',import.meta.url)),orbital:fileURLToPath(new URL('./study-01.html',import.meta.url))}}}});
