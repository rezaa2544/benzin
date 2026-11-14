import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Customer app (epic E9). Binds 0.0.0.0 so the sandbox preview can reach it, accepts any
 * Host header, and proxies `/v1` (+ the chat socket) to the API so the browser only ever
 * talks to its own origin — no CORS, no localhost URLs baked into the bundle.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/v1': {
        target: process.env['API_PROXY_TARGET'] ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
