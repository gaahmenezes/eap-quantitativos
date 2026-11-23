import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());

describe('empreendimentos: CRUD, versão e auditoria', () => {
  let c: Client;
  beforeAll(async () => {
    c = await signup(app, 'Org Projetos');
  });

  it('cria empreendimento, torna o criador COORDINATOR e audita com estado posterior', async () => {
    const res = await c.post('/api/projects', { ...newProject('CRUD-1'), code: 'crud-1' }).expect(201);
    expect(res.body.code).toBe('CRUD-1'); // normalizado
    expect(res.body.version).toBe(1);
    expect(res.body.myProjectRole).toBe('COORDINATOR');
    const audit = await c.get(`/api/projects/${res.body.id}/audit`).expect(200);
    expect(audit.body).toHaveLength(1);
    expect(audit.body[0]).toMatchObject({ action: 'CREATE', entityType: 'Project', before: null });
    expect(audit.body[0].after).toMatchObject({ code: 'CRUD-1', classification: 'VERTICAL' });
  });

  it('código duplicado na organização retorna 409', async () => {
    await c.post('/api/projects', newProject('DUP-1')).expect(201);
    const res = await c.post('/api/projects', newProject('DUP-1')).expect(409);
    expect(res.body.code).toBe('PROJECT_CODE_IN_USE');
  });

  it('valida classificação e campos obrigatórios', async () => {
    const res = await c.post('/api/projects', { code: 'X', name: '', classification: 'ORCAMENTO' }).expect(422);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['code', 'name', 'classification']),
    );
  });

  it('edição exige If-Match e detecta conflito de versão', async () => {
    const p = (await c.post('/api/projects', newProject('VER-1')).expect(201)).body;
    await c.patch(`/api/projects/${p.id}`, { name: 'Novo nome' }).expect(428);
    const ok = await c.patch(`/api/projects/${p.id}`, { name: 'Novo nome', reason: 'ajuste' }, { 'If-Match': '1' }).expect(200);
    expect(ok.body.version).toBe(2);
    const stale = await c.patch(`/api/projects/${p.id}`, { name: 'Outro' }, { 'If-Match': '1' }).expect(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    const audit = await c.get(`/api/projects/${p.id}/audit`).expect(200);
    const upd = audit.body.find((e: { action: string }) => e.action === 'UPDATE');
    expect(upd.before.name).toBe('Empreendimento VER-1');
    expect(upd.after.name).toBe('Novo nome');
    expect(upd.reason).toBe('ajuste');
  });

  it('arquivamento exige motivo, bloqueia edição e pode ser revertido', async () => {
    const p = (await c.post('/api/projects', newProject('ARQ-1')).expect(201)).body;
    await c.post(`/api/projects/${p.id}/archive`, {}, { 'If-Match': '1' }).expect(422);
    const arch = await c.post(`/api/projects/${p.id}/archive`, { reason: 'Obra cancelada' }, { 'If-Match': '1' }).expect(200);
    expect(arch.body.status).toBe('ARCHIVED');
    expect(arch.body.archivedAt).not.toBeNull();
    const blocked = await c.patch(`/api/projects/${p.id}`, { name: 'x' }, { 'If-Match': '2' }).expect(409);
    expect(blocked.body.code).toBe('PROJECT_ARCHIVED');
    const active = await c.get('/api/projects').expect(200);
    expect(active.body.map((x: { id: string }) => x.id)).not.toContain(p.id);
    const archived = await c.get('/api/projects?status=ARCHIVED').expect(200);
    expect(archived.body.map((x: { id: string }) => x.id)).toContain(p.id);
    const un = await c.post(`/api/projects/${p.id}/unarchive`, {}, { 'If-Match': '2' }).expect(200);
    expect(un.body.status).toBe('ACTIVE');
    // registro nunca é apagado
    expect(await prisma.project.count({ where: { id: p.id } })).toBe(1);
  });

  it('busca por nome/código e filtro por classificação', async () => {
    await c.post('/api/projects', { ...newProject('BUSCA-LOT'), name: 'Loteamento Jardim', classification: 'LOTEAMENTO' }).expect(201);
    const byName = await c.get('/api/projects?q=jardim').expect(200);
    expect(byName.body.map((p: { code: string }) => p.code)).toContain('BUSCA-LOT');
    const byClass = await c.get('/api/projects?classification=LOTEAMENTO').expect(200);
    expect(byClass.body.every((p: { classification: string }) => p.classification === 'LOTEAMENTO')).toBe(true);
  });

  it('auditoria é append-only no banco (UPDATE e DELETE bloqueados por trigger)', async () => {
    await expect(prisma.$executeRaw`UPDATE audit_log SET action = 'X'`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM audit_log`).rejects.toThrow(/append-only/);
  });

  it('banco impede vínculo de projeto com membro de outra organização (FK composta)', async () => {
    const other = await signup(app, 'Org Outra');
    const otherMe = await other.get('/api/auth/me').expect(200);
    const p = (await c.post('/api/projects', newProject('FK-1')).expect(201)).body;
    const me = await c.get('/api/auth/me').expect(200);
    await expect(
      prisma.projectMember.create({
        data: {
          organizationId: me.body.organization.id,
          projectId: p.id,
          userId: otherMe.body.user.id,
          role: 'VIEWER',
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.projectMember.create({
        data: {
          organizationId: otherMe.body.organization.id,
          projectId: p.id,
          userId: otherMe.body.user.id,
          role: 'VIEWER',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('convites', () => {
  it('token é exibido uma vez, armazenado só como hash e de uso único', async () => {
    const owner = await signup(app, 'Org Convite');
    const inv = await owner.post('/api/organization/invitations', { email: 'novo@teste.com.br', role: 'MEMBER' }).expect(201);
    expect(inv.body.token).toBeTruthy();
    const list = await owner.get('/api/organization/invitations').expect(200);
    expect(list.body[0].token).toBeUndefined();
    expect(await prisma.invitation.count({ where: { tokenHash: inv.body.token } })).toBe(0);
    const http = (await import('supertest')).default(app.getHttpServer());
    await http.post('/api/auth/accept-invitation').send({ token: inv.body.token, name: 'Novo', password: 'senha-de-teste-segura-123' }).expect(201);
    await http.post('/api/auth/accept-invitation').send({ token: inv.body.token, name: 'Novo', password: 'senha-de-teste-segura-123' }).expect(410);
  });
});
