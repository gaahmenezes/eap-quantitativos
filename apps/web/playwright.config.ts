import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// E2E contra API + web reais, usando o banco de TESTE (TEST_DATABASE_URL de apps/api/.env).
if (!process.env['TEST_DATABASE_URL'] && existsSync('../api/.env')) process.loadEnvFile('../api/.env');
const API_PORT = 3100;
const WEB_PORT = 5174;
const chromiumPath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'off',
    ...devices['Desktop Chrome'],
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: [
    {
      command: 'pnpm --filter @eapq/api exec prisma migrate deploy && pnpm --filter @eapq/api dev',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? '',
        PORT: String(API_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        RATE_LIMIT_ENABLED: 'false',
        NODE_ENV: 'test',
      },
    },
    {
      command: 'pnpm exec vite',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { WEB_PORT: String(WEB_PORT), API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
