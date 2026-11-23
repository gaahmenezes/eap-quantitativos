import type { OrgRole, Permission, ProjectRole } from '@eapq/domain';

export interface AuthContext {
  sessionId: string;
  userId: string;
  organizationId: string;
  orgRole: OrgRole;
  csrfToken: string;
  requestId: string;
}

export interface ProjectContext {
  projectId: string;
  projectRole: ProjectRole | null;
  permissions: ReadonlySet<Permission>;
}

/** Ator registrado na auditoria. */
export interface Actor {
  userId: string;
  organizationId: string;
  requestId: string;
}

export const actorOf = (a: AuthContext): Actor => ({
  userId: a.userId,
  organizationId: a.organizationId,
  requestId: a.requestId,
});
