import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
const path=(relative:string)=>fileURLToPath(new URL(relative,import.meta.url));
export default defineConfig({
  root: path('./web'), publicDir: path('./public'), plugins: [react()],
  resolve: { alias: { '@': path('./') } },
  server: { proxy: { '/api': 'http://127.0.0.1:3017' } },
  build: { outDir: path('./dist'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
