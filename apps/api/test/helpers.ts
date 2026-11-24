import { existsSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.factory.js';
import { loadConfig } from '../src/config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

if (!process.env['TEST_DATABASE_URL'] && existsSync('.env')) process.loadEnvFile('.env');

export const PASSWORD = 'senha-de-teste-segura-123';

export async function bootApp(overrides: Record<string, string> = {}): Promise<{ app: NestExpressApplication; prisma: PrismaService }> {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env['TEST_DATABASE_URL'],
    WEB_ORIGIN: 'http://localhost:5173',
    RATE_LIMIT_ENABLED: 'false',
    STORAGE_DIR: `${tmpdir()}/eapq-test-storage`,
    ...overrides,
  });
  const app = await createApp(config);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  email: string;
  /** Requisição mutável com CSRF. */
  post(url: string, body?: object, headers?: Record<string, string>): request.Test;
  patch(url: string, body?: object, headers?: Record<string, string>): request.Test;
  put(url: string, body?: object): request.Test;
  del(url: string): request.Test;
  get(url: string): request.Test;
}

function wrap(agent: ReturnType<typeof request.agent>, csrf: string, email: string): Client {
  const h = (extra?: Record<string, string>) => ({ 'X-CSRF-Token': csrf, ...(extra ?? {}) });
  return {
    agent,
    csrf,
    email,
    post: (u, b, x) => agent.post(u).set(h(x)).send(b ?? {}),
    patch: (u, b, x) => agent.patch(u).set(h(x)).send(b ?? {}),
    put: (u, b) => agent.put(u).set(h()).send(b ?? {}),
    del: (u) => agent.delete(u).set(h()),
    get: (u) => agent.get(u),
  };
}

export async function signup(app: NestExpressApplication, orgName = 'Org'): Promise<Client> {
  const agent = request.agent(app.getHttpServer());
  const email = `owner-${randomUUID()}@teste.com.br`;
  const res = await agent
    .post('/api/auth/signup')
    .send({ organizationName: orgName, name: 'Responsável', email, password: PASSWORD })
    .expect(201);
  return wrap(agent, res.body.csrfToken as string, email);
}

/** Convida e aceita, retornando um cliente autenticado do novo membro. */
export async function inviteAndJoin(
  app: NestExpressApplication,
  admin: Client,
  role: 'OWNER' | 'ADMIN' | 'MEMBER',
): Promise<Client & { userId: string }> {
  const email = `membro-${randomUUID()}@teste.com.br`;
  const inv = await admin.post('/api/organization/invitations', { email, role }).expect(201);
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post('/api/auth/accept-invitation')
    .send({ token: inv.body.token, name: 'Membro', password: PASSWORD })
    .expect(201);
  const me = await agent.get('/api/auth/me').expect(200);
  return { ...wrap(agent, res.body.csrfToken as string, email), userId: me.body.user.id as string };
}

export const newProject = (code = `P-${Math.floor(Math.random() * 1e8)}`) => ({
  code,
  name: `Empreendimento ${code}`,
  classification: 'VERTICAL',
  description: 'Duas torres residenciais',
});

/** Envio multipart (arquivo + campos) com CSRF. */
export function upload(c: Client, url: string, fields: Record<string, string>, fileName: string, content: Buffer) {
  let r = c.agent.post(url).set('X-CSRF-Token', c.csrf);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', content, fileName);
}

/** Leitura binária de resposta (exportações e downloads). */
export function binary(r: request.Test) {
  return r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (d: Buffer) => chunks.push(d));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}
