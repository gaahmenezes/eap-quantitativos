import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MyTaskDto, SheetTemplateDto, TaskDto, TeamMemberDto } from '@eapq/contracts';
import { bootApp, inviteAndJoin, newProject, signup, type Client } from './helpers.js';

const { app, prisma } = await bootApp();
afterAll(() => app.close());
const ifm = (v: number) => ({ 'If-Match': String(v) });

describe('fila de trabalho do empreendimento', () => {
  let gestor: Client; // dono da organização (revisor)
  let eng: Client & { userId: string }; // engenheira com edição no empreendimento
  let leitor: Client & { userId: string };
  let p: string;
  let sheetId: string;
  let gestorId: string;
  const base = () => `/api/projects/${p}/tasks`;
  const get = async (c: Client, id: string) => ((await c.get(base()).expect(200)).body as TaskDto[]).find((t) => t.id === id)!;
  const go = async (c: Client, id: string, to: string, comment?: string) => { const t = await get(c, id); return c.post(`${base()}/${id}/transition`, { to, ...(comment && { comment }) }, ifm(t.version)); };

  beforeAll(async () => {
    gestor = await signup(app, 'Org Tarefas');
    gestorId = (await gestor.get('/api/auth/me').expect(200)).body.user.id;
    p = (await gestor.post('/api/projects', newProject()).expect(201)).body.id;
    eng = await inviteAndJoin(app, gestor, 'MEMBER');
    leitor = await inviteAndJoin(app, gestor, 'MEMBER');
    const org = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    await prisma.projectMember.createMany({ data: [
      { organizationId: org.organizationId, projectId: p, userId: eng.userId, role: 'EDITOR' },
      { organizationId: org.organizationId, projectId: p, userId: leitor.userId, role: 'VIEWER' },
    ] });
    const tpl = ((await gestor.get('/api/sheet-templates').expect(200)).body as SheetTemplateDto[]).find((t) => t.code === 'CER')!;
    sheetId = (await gestor.post(`/api/projects/${p}/sheets`, { templateVersionId: tpl.versions[0]!.id, title: 'Cerâmica — tipo A' }).expect(201)).body.id;
  });

  it('equipe do empreendimento com permissão de edição', async () => {
    const team = (await eng.get(`/api/projects/${p}/team`).expect(200)).body as TeamMemberDto[];
    expect(team.find((x) => x.id === gestorId)).toMatchObject({ canEdit: true });
    expect(team.find((x) => x.id === eng.userId)).toMatchObject({ canEdit: true });
    expect(team.find((x) => x.id === leitor.userId)).toMatchObject({ canEdit: false });
  });

  it('cria tarefa ligada à ficha; leitor não pode ser responsável; pessoa de fora não existe', async () => {
    await gestor.post(base(), { title: 'Levantar cerâmica', assigneeId: leitor.userId }).expect(422);
    const fora = await signup(app, 'Org Fora');
    const foraId = (await fora.get('/api/auth/me').expect(200)).body.user.id;
    await gestor.post(base(), { title: 'Levantar cerâmica', assigneeId: foraId }).expect(404);
    const otherP = (await gestor.post('/api/projects', newProject()).expect(201)).body.id;
    const tpl = ((await gestor.get('/api/sheet-templates').expect(200)).body as SheetTemplateDto[])[0]!;
    const otherSheet = (await gestor.post(`/api/projects/${otherP}/sheets`, { templateVersionId: tpl.versions[0]!.id, title: 'X' }).expect(201)).body.id;
    await gestor.post(base(), { title: 'Errada', link: { kind: 'SHEET', id: otherSheet } }).expect(404);
    const r = (await gestor.post(base(), { title: 'Levantar cerâmica do tipo A', link: { kind: 'SHEET', id: sheetId }, assigneeId: eng.userId, reviewerId: gestorId, dueDate: '2020-01-31' }).expect(201)).body;
    const t = await get(eng, r.id);
    expect(t).toMatchObject({ status: 'TODO', kind: 'SHEET', link: { kind: 'SHEET', id: sheetId, label: 'Cerâmica — tipo A' }, assignee: { id: eng.userId }, reviewer: { id: gestorId }, dueDate: '2020-01-31', overdue: true });
  });

  it('fluxo com revisão: só o revisor aprova ou devolve; devolver exige comentário', async () => {
    const t = ((await eng.get(`${base()}?assignee=me`).expect(200)).body as TaskDto[])[0]!;
    expect((await go(eng, t.id, 'DOING')).status).toBe(204);
    expect((await go(eng, t.id, 'DONE')).status).toBe(409);
    expect((await go(eng, t.id, 'REVIEW')).status).toBe(204);
    const mineG = (await gestor.get('/api/tasks/mine').expect(200)).body as MyTaskDto[];
    expect(mineG.find((x) => x.id === t.id)).toMatchObject({ role: 'REVIEWER', status: 'REVIEW' });
    expect((await go(eng, t.id, 'DONE')).body.code).toBe('NOT_REVIEWER');
    expect((await go(gestor, t.id, 'DOING')).status).toBe(422);
    expect((await go(gestor, t.id, 'DOING', 'Faltou o rodapé da varanda')).status).toBe(204);
    expect((await go(eng, t.id, 'REVIEW')).status).toBe(204);
    expect((await go(gestor, t.id, 'DONE')).status).toBe(204);
    const done = await get(gestor, t.id);
    expect(done).toMatchObject({ status: 'DONE', overdue: false });
    expect(done.completedAt).not.toBeNull();
    expect((await go(eng, t.id, 'DOING')).status).toBe(422); // reabrir exige motivo
    const log = await prisma.auditLog.findMany({ where: { entityType: 'WorkTask', entityId: t.id, action: 'TRANSITION' }, orderBy: { at: 'asc' } });
    expect(log.map((l) => (l.after as { status: string }).status)).toEqual(['DOING', 'REVIEW', 'DOING', 'REVIEW', 'DONE']);
    expect(log[2]!.reason).toBe('Faltou o rodapé da varanda');
    expect(((await eng.get('/api/tasks/mine').expect(200)).body as MyTaskDto[]).find((x) => x.id === t.id)).toBeUndefined();
  });

  it('sem revisor: conclui direto; não há revisão; transição inválida recusada', async () => {
    const id = (await eng.post(base(), { title: 'Conferir quadro de esquadrias', assigneeId: eng.userId }).expect(201)).body.id;
    expect((await go(eng, id, 'DOING')).status).toBe(204);
    expect((await go(eng, id, 'REVIEW')).status).toBe(422);
    const mine = (await eng.get('/api/tasks/mine').expect(200)).body as MyTaskDto[];
    expect(mine.find((x) => x.id === id)).toMatchObject({ role: 'ASSIGNEE', projectCode: expect.any(String) });
    expect((await go(eng, id, 'DONE')).status).toBe(204);
    expect((await go(eng, id, 'TODO')).body.code).toBe('INVALID_TRANSITION');
  });

  it('edição com If-Match, leitor só consulta, outra organização não vê; tarefa não é apagada', async () => {
    const id = (await gestor.post(base(), { title: 'Migrar planilha antiga' }).expect(201)).body.id;
    const t = await get(gestor, id);
    await eng.patch(`${base()}/${id}`, { title: 'Migrar planilha VMB', assigneeId: eng.userId }, ifm(t.version)).expect(204);
    await eng.patch(`${base()}/${id}`, { title: 'X' }, ifm(t.version)).expect(409);
    await leitor.get(base()).expect(200);
    await leitor.post(base(), { title: 'X' }).expect(403);
    const intruso = await signup(app, 'Org Intrusa Tarefas');
    await intruso.get(base()).expect(404);
    await intruso.get(`/api/projects/${p}/team`).expect(404);
    expect(((await intruso.get('/api/tasks/mine').expect(200)).body as unknown[]).length).toBe(0);
    await expect(prisma.$executeRaw`DELETE FROM work_task WHERE id = ${id}::uuid`).rejects.toThrow(/não são apagadas/);
    const t2 = await get(gestor, id);
    await gestor.post(`${base()}/${id}/archive`, {}, ifm(t2.version)).expect(204);
    expect(await get(gestor, id)).toBeUndefined();
  });
});
