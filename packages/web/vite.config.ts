import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev mode: the UI runs here (default :3000) and proxies /api to the server on :3001.
const apiPort = process.env.HEARTH_API_PORT || '3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.HEARTH_WEB_PORT || 3000),
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 6000, sourcemap: false },
});
