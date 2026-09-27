import {defineConfig} from 'vite';
// Satellite.js 7 also exports optional WASM workers. Vite visits those modules
// before tree-shaking; their top-level await needs ES-format worker output.
export default defineConfig({base:'./',worker:{format:'es'}});
