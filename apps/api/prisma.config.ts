import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Carrega .env local se existir (dev). Em CI/produção as variáveis vêm do ambiente.
if (!process.env['DATABASE_URL'] && existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'pnpm seed' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
