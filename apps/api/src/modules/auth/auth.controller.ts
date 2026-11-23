import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  acceptInvitationSchema,
  loginSchema,
  signupSchema,
  type AcceptInvitationInput,
  type LoginInput,
  type SignupInput,
} from '@eapq/contracts';
import { Auth, Authenticated, Public } from '../../common/auth/decorators.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { SessionService } from '../../common/auth/session.service.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { AuthService } from './auth.service.js';

const meta = (req: Request & { id: string }) => ({
  ip: req.ip,
  userAgent: req.header('user-agent'),
  requestId: req.id,
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('signup')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signup(
    @Body(new ZodPipe(signupSchema)) body: SignupInput,
    @Req() req: Request & { id: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.auth.signup(body, meta(req));
    this.sessions.setCookie(res, s.token, s.expiresAt);
    return { csrfToken: s.csrfToken };
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() req: Request & { id: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.auth.login(body, meta(req));
    this.sessions.setCookie(res, s.token, s.expiresAt);
    return { csrfToken: s.csrfToken };
  }

  @Post('accept-invitation')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async acceptInvitation(
    @Body(new ZodPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
    @Req() req: Request & { id: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.auth.acceptInvitation(body, meta(req));
    this.sessions.setCookie(res, s.token, s.expiresAt);
    return { csrfToken: s.csrfToken };
  }

  @Post('logout')
  @Authenticated()
  @HttpCode(204)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(auth.sessionId);
    this.sessions.clearCookie(res);
  }

  @Get('me')
  @Authenticated()
  me(@Auth() auth: AuthContext) {
    return this.auth.me(auth);
  }
}
