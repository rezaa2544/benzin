import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Admin SPA (epic E8). The dev server binds 0.0.0.0 so the sandbox preview proxy can
 * reach it, accepts any Host header, and forwards `/v1` to the API — the browser only
 * ever talks to its own origin, which keeps CORS and preview hosts irrelevant.
 */
export default defineConfig({
  plugins: [react()],
  // Behind Caddy the panel is mounted on /admin/ (infra/Caddyfile strips the prefix),
  // so production builds need that base for absolute asset URLs. Dev stays on /.
  base: process.env['ADMIN_BASE'] ?? '/',
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/v1': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
