import { Inject, Injectable } from '@nestjs/common';
import type { AcceptInvitationInput, LoginInput, MeResponse, SignupInput } from '@eapq/contracts';
import { orgPermissions } from '@eapq/domain';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { AppError, conflict, forbidden } from '../../common/errors.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { SessionService } from '../../common/auth/session.service.js';
import { sha256 } from '../../common/auth/tokens.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { LibraryService } from '../library/library.service.js';
import { burnVerify, hashPassword, verifyPassword } from './password.js';

const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Não autenticado', 'E-mail ou senha inválidos.');

interface Meta {
  ip?: string;
  userAgent?: string;
  requestId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly library: LibraryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Cria organização + usuário OWNER. */
  async signup(input: SignupInput, meta: Meta) {
    if (!this.config.ALLOW_SIGNUP) throw forbidden('Cadastro público desabilitado.');
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('EMAIL_IN_USE', 'Já existe uma conta com este e-mail.');
    const passwordHash = await hashPassword(input.password);
    const { user, org } = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: input.organizationName } });
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash },
      });
      await tx.membership.create({ data: { organizationId: org.id, userId: user.id, role: 'OWNER' } });
      await this.catalog.ensureDefaults(tx, org.id);
      await this.library.ensureLibrary(tx, org.id);
      const actor = { userId: user.id, organizationId: org.id, requestId: meta.requestId };
      await this.audit.record(tx, actor, {
        entityType: 'Organization',
        entityId: org.id,
        action: 'CREATE',
        after: { name: org.name, owner: { id: user.id, email: user.email } },
      });
      return { user, org };
    }, { timeout: 30_000 });
    return this.sessions.create(user.id, org.id, meta);
  }

  async login(input: LoginInput, meta: Meta) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    if (!user) {
      await burnVerify(input.password);
      throw invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await burnVerify(input.password);
      throw new AppError(
        423,
        'ACCOUNT_LOCKED',
        'Conta bloqueada temporariamente',
        `Muitas tentativas inválidas. Tente novamente em até ${LOCK_MINUTES} minutos.`,
      );
    }
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw invalidCredentials();
    }
    const membership = user.memberships[0];
    if (user.status !== 'ACTIVE' || !membership) throw invalidCredentials();
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }
    return this.sessions.create(user.id, membership.organizationId, meta);
  }

  async acceptInvitation(input: AcceptInvitationInput, meta: Meta) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(input.token) },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date()
    ) {
      throw new AppError(410, 'INVITATION_INVALID', 'Convite inválido', 'Convite inválido, expirado ou já utilizado.');
    }
    const passwordHash = await hashPassword(input.password);
    const userId = await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email: invitation.email } });
      if (user) {
        // Usuário já existe (outra organização): não alteramos sua senha pelo convite.
        if (!(await verifyPassword(user.passwordHash, input.password))) {
          throw new AppError(
            409,
            'EXISTING_ACCOUNT',
            'Conta existente',
            'Este e-mail já possui conta. Informe a senha atual da conta para aceitar o convite.',
          );
        }
      } else {
        user = await tx.user.create({
          data: { email: invitation.email, name: input.name, passwordHash },
        });
      }
      const updated = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (updated.count !== 1) throw conflict('INVITATION_INVALID', 'Convite já utilizado.');
      await tx.membership.create({
        data: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role },
      });
      await this.audit.record(
        tx,
        { userId: user.id, organizationId: invitation.organizationId, requestId: meta.requestId },
        {
          entityType: 'Membership',
          entityId: user.id,
          action: 'INVITATION_ACCEPTED',
          after: { email: user.email, role: invitation.role, invitationId: invitation.id },
        },
      );
      return user.id;
    });
    return this.sessions.create(userId, invitation.organizationId, meta);
  }

  async me(auth: AuthContext): Promise<MeResponse> {
    const [user, org] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } }),
    ]);
    return {
      user: { id: user.id, name: user.name, email: user.email },
      organization: { id: org.id, name: org.name },
      orgRole: auth.orgRole,
      permissions: [...orgPermissions(auth.orgRole)],
      csrfToken: auth.csrfToken,
    };
  }
}
