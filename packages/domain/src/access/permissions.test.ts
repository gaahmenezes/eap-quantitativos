import { describe, expect, it } from 'vitest';
import { canAccessProject, orgPermissions, projectPermissions } from './permissions.js';

describe('matriz de permissões', () => {
  it('OWNER e ADMIN acessam qualquer empreendimento da organização', () => {
    expect(canAccessProject('OWNER', null)).toBe(true);
    expect(canAccessProject('ADMIN', null)).toBe(true);
  });
  it('MEMBER sem vínculo não acessa o empreendimento', () => {
    expect(canAccessProject('MEMBER', null)).toBe(false);
  });
  it('MEMBER VIEWER apenas lê', () => {
    const p = projectPermissions('MEMBER', 'VIEWER');
    expect(p.has('project.read')).toBe(true);
    expect(p.has('project.update')).toBe(false);
    expect(p.has('project.content.edit')).toBe(false);
  });
  it('MEMBER EDITOR edita conteúdo mas não arquiva nem gerencia membros', () => {
    const p = projectPermissions('MEMBER', 'EDITOR');
    expect(p.has('project.content.edit')).toBe(true);
    expect(p.has('project.archive')).toBe(false);
    expect(p.has('project.members.manage')).toBe(false);
  });
  it('apenas OWNER/ADMIN criam empreendimentos e gerenciam membros da organização', () => {
    expect(orgPermissions('MEMBER').has('project.create')).toBe(false);
    expect(orgPermissions('ADMIN').has('project.create')).toBe(true);
    expect(orgPermissions('MEMBER').has('org.members.manage')).toBe(false);
  });
});
