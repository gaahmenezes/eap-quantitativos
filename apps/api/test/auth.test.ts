import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, PASSWORD, signup } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

describe('autenticação e sessão', () => {
  let email: string;
  beforeAll(async () => {
    email = (await signup(app, 'Construtora Auth')).email;
  });

  it('armazena a senha apenas como hash argon2id', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it('login válido cria sessão httpOnly e /me retorna o contexto', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.orgRole).toBe('OWNER');
    expect(me.body.organization.name).toBe('Construtora Auth');
    // somente hash do token fica no banco
    const token = /eapq_session=([^;]+)/.exec(cookie)![1]!;
    expect(await prisma.session.count({ where: { tokenHash: token } })).toBe(0);
  });

  it('credenciais inválidas retornam erro genérico (sem enumerar usuários)', async () => {
    const a = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'senha-errada-qualquer' })
      .expect(401);
    const b = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'naoexiste@teste.com.br', password: 'senha-errada-qualquer' })
      .expect(401);
    expect(a.body.code).toBe('INVALID_CREDENTIALS');
    expect(b.body.code).toBe('INVALID_CREDENTIALS');
    expect(a.body.detail).toBe(b.body.detail);
  });

  it('bloqueia a conta após 10 tentativas inválidas', async () => {
    const c = await signup(app, 'Org Lock');
    const http = request(app.getHttpServer());
    for (let i = 0; i < 10; i++) {
      await http.post('/api/auth/login').send({ email: c.email, password: 'x'.repeat(12) }).expect(401);
    }
    const locked = await http.post('/api/auth/login').send({ email: c.email, password: PASSWORD });
    expect(locked.status).toBe(423);
  });

  it('logout revoga a sessão no servidor', async () => {
    const c = await signup(app, 'Org Logout');
    await c.post('/api/auth/logout').expect(204);
    await c.get('/api/auth/me').expect(401);
  });

  it('requisição mutável sem token CSRF é rejeitada', async () => {
    const c = await signup(app, 'Org CSRF');
    const res = await c.agent.post('/api/projects').send({ code: 'X1', name: 'X', classification: 'VERTICAL' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('requisição mutável de origem não permitida é rejeitada', async () => {
    const c = await signup(app, 'Org Origin');
    const res = await c.post('/api/projects', { code: 'X2', name: 'X', classification: 'VERTICAL' }, {
      Origin: 'https://site-malicioso.example',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_REJECTED');
  });

  it('valida entrada no backend (senha curta, e-mail inválido)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ organizationName: 'X', name: 'Y', email: 'invalido', password: 'curta' })
      .expect(422);
    const paths = res.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('e-mail duplicado no cadastro retorna 409', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/signup')
      .send({ organizationName: 'Dup', name: 'Y', email, password: PASSWORD })
      .expect(409);
  });
});

describe('limitação de taxa', () => {
  it('limita tentativas de login por IP (10/min)', async () => {
    const limited = await bootApp({ RATE_LIMIT_ENABLED: 'true' });
    try {
      const http = request(limited.app.getHttpServer());
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const r = await http.post('/api/auth/login').send({ email: 'x@teste.com.br', password: 'qualquer-coisa' });
        statuses.push(r.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    } finally {
      await limited.app.close();
    }
  });
});
