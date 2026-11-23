import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { newToken, sha256 } from './tokens.js';

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get cookieName(): string {
    return this.config.NODE_ENV === 'production' ? '__Host-eapq_session' : 'eapq_session';
  }

  async create(
    userId: string,
    organizationId: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
    const token = newToken();
    const csrfToken = newToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_HOURS * 3600_000);
    await this.prisma.session.create({
      data: {
        tokenHash: sha256(token),
        csrfToken,
        userId,
        organizationId,
        expiresAt,
        ip: meta.ip?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 400) ?? null,
      },
    });
    return { token, csrfToken, expiresAt };
  }

  async findValid(token: string) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { select: { status: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    if (session.user.status !== 'ACTIVE') return null;
    const membership = await this.prisma.membership.findUnique({
      where: {
        organizationId_userId: { organizationId: session.organizationId, userId: session.userId },
      },
    });
    if (!membership) return null;
    // Atualização de "lastSeen" com granularidade de 5 min para evitar escrita a cada requisição.
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return { session, role: membership.role };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, organizationId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(organizationId ? { organizationId } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
  }

  clearCookie(res: Response): void {
    res.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
  }
}
