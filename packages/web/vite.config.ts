import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev mode: the UI runs here (default :4545, the same URL as production) and proxies /api to the server on :4546.
const webPort = Number(process.env.HEARTH_WEB_PORT || 4545);
const apiPort = process.env.HEARTH_API_PORT || String(webPort + 1);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: 'localhost',
    port: webPort,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}` } },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 6000, sourcemap: false },
});
