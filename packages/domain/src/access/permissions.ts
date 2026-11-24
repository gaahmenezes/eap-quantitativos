/**
 * Matriz de permissões (ADR-007). Papéis de organização e de empreendimento são
 * combinados: OWNER/ADMIN da organização têm acesso total a todos os empreendimentos;
 * MEMBER depende do papel atribuído em cada empreendimento.
 */
export const ORG_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PROJECT_ROLES = ['COORDINATOR', 'EDITOR', 'VIEWER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PERMISSIONS = [
  'org.read',
  'org.manage', // dados da organização
  'org.members.manage',
  'project.create',
  'project.read',
  'project.update',
  'project.archive',
  'project.members.manage',
  'project.content.edit', // cadastro físico, EAP, medições (fases seguintes)
  'project.revisions.issue', // emitir revisões formais (R00, R01…)
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ORG_LEVEL: Record<OrgRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS,
  MEMBER: ['org.read'],
};

const PROJECT_LEVEL: Record<ProjectRole, readonly Permission[]> = {
  COORDINATOR: [
    'project.read',
    'project.update',
    'project.archive',
    'project.members.manage',
    'project.content.edit',
    'project.revisions.issue',
    'audit.read',
  ],
  EDITOR: ['project.read', 'project.content.edit', 'audit.read'],
  VIEWER: ['project.read'],
};

/** Permissões efetivas de um usuário fora de um empreendimento específico. */
export function orgPermissions(orgRole: OrgRole): ReadonlySet<Permission> {
  return new Set(ORG_LEVEL[orgRole]);
}

/**
 * Permissões efetivas num empreendimento. `projectRole` nulo significa que o usuário
 * não é membro do empreendimento (MEMBER sem vínculo não enxerga o projeto).
 */
export function projectPermissions(
  orgRole: OrgRole,
  projectRole: ProjectRole | null,
): ReadonlySet<Permission> {
  const set = new Set<Permission>(ORG_LEVEL[orgRole]);
  if (projectRole) for (const p of PROJECT_LEVEL[projectRole]) set.add(p);
  return set;
}

export function canAccessProject(orgRole: OrgRole, projectRole: ProjectRole | null): boolean {
  return projectPermissions(orgRole, projectRole).has('project.read');
}
