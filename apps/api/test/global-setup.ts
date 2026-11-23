import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import pg from 'pg';

/** Recria o schema do banco de TESTE e aplica as migrações versionadas. */
export default async function setup() {
  if (!process.env['TEST_DATABASE_URL'] && existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL não definido');
  if (!/test/.test(new URL(url).pathname)) {
    throw new Error(`Recusando limpar banco que não parece de teste: ${new URL(url).pathname}`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.end();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  process.env['DATABASE_URL'] = url;
}
