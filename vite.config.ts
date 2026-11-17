import { defineConfig } from 'vite';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
};

export default defineConfig({
  base: '/',
  server: { headers: isolationHeaders, allowedHosts: ['pchess.local', 'pchess.localhost'] },
  preview: {
    headers: { ...isolationHeaders, 'Cache-Control': 'public, max-age=3600' },
    allowedHosts: ['pchess.local', 'pchess.localhost'],
  },
  build: { target: 'es2022' },
});
