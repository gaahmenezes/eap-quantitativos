import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Os testes de integração compartilham um banco real; rodar arquivos em sequência.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
