import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, inviteAndJoin, newProject, signup, type Client } from './helpers.js';

const { app } = await bootApp();
afterAll(() => app.close());

/** Acesso indevido entre organizações e entre empreendimentos (RNF01 / ADR-007). */
describe('isolamento entre organizações', () => {
  let a: Client;
  let b: Client;
  let projectA: { id: string; version: number };
  let memberA: Client & { userId: string };

  beforeAll(async () => {
    a = await signup(app, 'Org A');
    b = await signup(app, 'Org B');
    const res = await a.post('/api/projects', newProject('ISO-A')).expect(201);
    projectA = res.body;
    memberA = await inviteAndJoin(app, a, 'MEMBER');
  });

  const projectRoutes = () => [
    ['GET', `/api/projects/${projectA.id}`],
    ['PATCH', `/api/projects/${projectA.id}`],
    ['POST', `/api/projects/${projectA.id}/archive`],
    ['POST', `/api/projects/${projectA.id}/unarchive`],
    ['GET', `/api/projects/${projectA.id}/members`],
    ['PUT', `/api/projects/${projectA.id}/members/${memberA.userId}`],
    ['DELETE', `/api/projects/${projectA.id}/members/${memberA.userId}`],
    ['GET', `/api/projects/${projectA.id}/audit`],
  ] as const;

  const call = (c: Client, method: string, url: string) => {
    const headers = { 'If-Match': '1' };
    switch (method) {
      case 'GET':
        return c.get(url);
      case 'PATCH':
        return c.patch(url, { name: 'invasão' }, headers);
      case 'POST':
        return c.post(url, { reason: 'invasão' }, headers);
      case 'PUT':
        return c.put(url, { role: 'EDITOR' });
      default:
        return c.del(url);
    }
  };

  it('OWNER de outra organização recebe 404 em TODAS as rotas do empreendimento', async () => {
    for (const [method, url] of projectRoutes()) {
      const res = await call(b, method, url);
      expect(res.status, `${method} ${url}`).toBe(404);
    }
  });

  it('MEMBER sem vínculo ao empreendimento (mesma organização) recebe 404', async () => {
    for (const [method, url] of projectRoutes()) {
      const res = await call(memberA, method, url);
      expect(res.status, `${method} ${url}`).toBe(404);
    }
  });

  it('listagem não vaza empreendimentos de outra organização', async () => {
    const res = await b.get('/api/projects?status=ALL').expect(200);
    expect(res.body.find((p: { id: string }) => p.id === projectA.id)).toBeUndefined();
    const member = await memberA.get('/api/projects?status=ALL').expect(200);
    expect(member.body).toHaveLength(0);
  });

  it('não é possível vincular usuário de outra organização a um empreendimento', async () => {
    const outsider = await inviteAndJoin(app, b, 'MEMBER');
    await a.put(`/api/projects/${projectA.id}/members/${outsider.userId}`, { role: 'EDITOR' }).expect(404);
  });

  it('membros e convites são isolados por organização', async () => {
    const members = await b.get('/api/organization/members').expect(200);
    expect(members.body.find((m: { userId: string }) => m.userId === memberA.userId)).toBeUndefined();
    await b.del(`/api/organization/members/${memberA.userId}`).expect(404);
  });

  it('mesmo código de empreendimento é permitido em organizações diferentes', async () => {
    await b.post('/api/projects', newProject('ISO-A')).expect(201);
  });

  it('identificador malformado retorna 404 (não 500)', async () => {
    await a.get('/api/projects/nao-e-uuid').expect(404);
  });
});

describe('papéis no empreendimento', () => {
  let owner: Client;
  let viewer: Client & { userId: string };
  let editor: Client & { userId: string };
  let projectId: string;

  beforeAll(async () => {
    owner = await signup(app, 'Org Papéis');
    projectId = (await owner.post('/api/projects', newProject('ROLES')).expect(201)).body.id;
    viewer = await inviteAndJoin(app, owner, 'MEMBER');
    editor = await inviteAndJoin(app, owner, 'MEMBER');
    await owner.put(`/api/projects/${projectId}/members/${viewer.userId}`, { role: 'VIEWER' }).expect(204);
    await owner.put(`/api/projects/${projectId}/members/${editor.userId}`, { role: 'EDITOR' }).expect(204);
  });

  it('VIEWER lê mas não edita, não arquiva e não gerencia membros', async () => {
    await viewer.get(`/api/projects/${projectId}`).expect(200);
    await viewer.patch(`/api/projects/${projectId}`, { name: 'x' }, { 'If-Match': '1' }).expect(403);
    await viewer.post(`/api/projects/${projectId}/archive`, { reason: 'x' }, { 'If-Match': '1' }).expect(403);
    await viewer.put(`/api/projects/${projectId}/members/${editor.userId}`, { role: 'VIEWER' }).expect(403);
    await viewer.get(`/api/projects/${projectId}/audit`).expect(403);
  });

  it('EDITOR não altera os dados cadastrais nem arquiva', async () => {
    await editor.patch(`/api/projects/${projectId}`, { name: 'x' }, { 'If-Match': '1' }).expect(403);
    await editor.post(`/api/projects/${projectId}/archive`, { reason: 'x' }, { 'If-Match': '1' }).expect(403);
    await editor.get(`/api/projects/${projectId}/audit`).expect(200);
  });

  it('MEMBER não cria empreendimentos nem convida', async () => {
    await viewer.post('/api/projects', newProject()).expect(403);
    await viewer.post('/api/organization/invitations', { email: 'x@teste.com.br', role: 'MEMBER' }).expect(403);
  });

  it('ADMIN não pode conceder OWNER', async () => {
    const admin = await inviteAndJoin(app, owner, 'ADMIN');
    await admin.patch(`/api/organization/members/${viewer.userId}`, { role: 'OWNER' }).expect(403);
    await admin.patch(`/api/organization/members/${viewer.userId}`, { role: 'ADMIN' }).expect(204);
  });

  it('membro removido da organização perde a sessão e os vínculos', async () => {
    await owner.del(`/api/organization/members/${editor.userId}`).expect(204);
    await editor.get('/api/auth/me').expect(401);
    const members = await owner.get(`/api/projects/${projectId}/members`).expect(200);
    expect(members.body.map((m: { userId: string }) => m.userId)).not.toContain(editor.userId);
  });

  it('não é possível remover o último OWNER', async () => {
    const me = await owner.get('/api/auth/me').expect(200);
    const other = await inviteAndJoin(app, owner, 'ADMIN');
    await other.del(`/api/organization/members/${me.body.user.id}`).expect(403);
    await owner.patch(`/api/organization/members/${me.body.user.id}`, { role: 'ADMIN' }).expect(409);
  });
});
