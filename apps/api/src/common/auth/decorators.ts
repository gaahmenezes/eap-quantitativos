import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@eapq/domain';
import type { AuthContext, ProjectContext } from './auth-context.js';

export const ACCESS_KEY = 'eapq:access';

/**
 * Toda rota DEVE declarar um destes (o guard nega rotas sem declaração — fail closed):
 * - @Public(): sem sessão (login, signup…)
 * - @Authenticated(): qualquer sessão válida
 * - @OrgPermission(p): permissão na organização
 * - @ProjectPermission(p, param): permissão no empreendimento do parâmetro de rota
 */
export type AccessRule =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'org'; permission: Permission }
  | { kind: 'project'; permission: Permission; param: string };

export const Public = () => SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies AccessRule);
export const Authenticated = () =>
  SetMetadata(ACCESS_KEY, { kind: 'authenticated' } satisfies AccessRule);
export const OrgPermission = (permission: Permission) =>
  SetMetadata(ACCESS_KEY, { kind: 'org', permission } satisfies AccessRule);
export const ProjectPermission = (permission: Permission, param = 'projectId') =>
  SetMetadata(ACCESS_KEY, { kind: 'project', permission, param } satisfies AccessRule);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
  if (!req.auth) throw new Error('Auth() usado em rota sem autenticação');
  return req.auth;
});

export const ProjectCtx = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ProjectContext => {
    const req = ctx.switchToHttp().getRequest<{ project?: ProjectContext }>();
    if (!req.project) throw new Error('ProjectCtx() usado em rota sem @ProjectPermission');
    return req.project;
  },
);
