import { type CanActivate, type ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { orgPermissions, projectPermissions } from '@eapq/domain';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { forbidden, notFound, unauthorized, AppError } from '../errors.js';
import { uuidPipe } from '../zod.pipe.js';
import type { AuthContext, ProjectContext } from './auth-context.js';
import { ACCESS_KEY, type AccessRule } from './decorators.js';
import { SessionService } from './session.service.js';
import { safeEqual } from './tokens.js';

type Req = Request & { id: string; auth?: AuthContext; project?: ProjectContext };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guard global: sessão, CSRF, origem e autorização (org/projeto) — ADR-006/007.
 * Rotas sem regra declarada são negadas.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!rule) {
      this.logger.error(`Rota sem regra de acesso: ${req.method} ${req.path}`);
      throw forbidden('Rota sem política de acesso definida.');
    }

    const mutating = !SAFE_METHODS.has(req.method);
    if (mutating) this.checkOrigin(req);
    if (rule.kind === 'public') return true;

    const token = (req.cookies as Record<string, string> | undefined)?.[this.sessions.cookieName];
    if (!token) throw unauthorized();
    const found = await this.sessions.findValid(token);
    if (!found) throw unauthorized('Sessão expirada ou inválida.');

    const { session, role } = found;
    if (mutating) {
      const header = req.header('x-csrf-token') ?? '';
      if (!safeEqual(header, session.csrfToken)) {
        throw new AppError(403, 'CSRF_INVALID', 'Acesso negado', 'Token CSRF ausente ou inválido.');
      }
    }
    req.auth = {
      sessionId: session.id,
      userId: session.userId,
      organizationId: session.organizationId,
      orgRole: role,
      csrfToken: session.csrfToken,
      requestId: req.id,
    };

    if (rule.kind === 'authenticated') return true;
    if (rule.kind === 'org') {
      if (!orgPermissions(role).has(rule.permission)) throw forbidden();
      return true;
    }

    // Projeto: inexistente, de outra organização ou sem vínculo ⇒ 404 (não revela existência).
    const projectId = uuidPipe.transform(req.params[rule.param]);
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: session.organizationId },
      select: { id: true, members: { where: { userId: session.userId }, select: { role: true } } },
    });
    if (!project) throw notFound('Empreendimento');
    const projectRole = project.members[0]?.role ?? null;
    const perms = projectPermissions(role, projectRole);
    if (!perms.has('project.read')) throw notFound('Empreendimento');
    if (!perms.has(rule.permission)) throw forbidden();
    req.project = { projectId, projectRole, permissions: perms };
    return true;
  }

  private checkOrigin(req: Req): void {
    const origin = req.header('origin');
    // Navegadores sempre enviam Origin em requisições mutáveis cross-site; ausência = cliente não-navegador.
    if (origin && origin !== this.config.WEB_ORIGIN) {
      throw new AppError(403, 'ORIGIN_REJECTED', 'Acesso negado', 'Origem da requisição não permitida.');
    }
  }
}
