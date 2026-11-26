import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // demonstração: um único arquivo JS (inclusive o leitor de XLSX carregado sob demanda), para virar uma página só
  ...(process.env['VITE_DEMO'] === '1' && { build: { rollupOptions: { output: { inlineDynamicImports: true } } } }),
  server: {
    port: Number(process.env['WEB_PORT'] ?? 5173),
    strictPort: true,
    // Mesmo site da API: cookies de sessão SameSite=Lax funcionam sem CORS (ADR-006).
    proxy: { '/api': { target: process.env['API_URL'] ?? 'http://localhost:3000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
});
