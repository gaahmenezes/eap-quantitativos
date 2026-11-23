import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  createInvitationSchema,
  updateMemberRoleSchema,
  type CreateInvitationInput,
} from '@eapq/contracts';
import type { OrgRole } from '@eapq/domain';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, OrgPermission } from '../../common/auth/decorators.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { OrganizationsService } from './organizations.service.js';

@Controller('organization')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('members')
  @OrgPermission('org.read')
  members(@Auth() auth: AuthContext) {
    return this.orgs.listMembers(auth.organizationId);
  }

  @Patch('members/:userId')
  @OrgPermission('org.members.manage')
  @HttpCode(204)
  async updateRole(
    @Auth() auth: AuthContext,
    @Param('userId', uuidPipe) userId: string,
    @Body(new ZodPipe(updateMemberRoleSchema)) body: { role: OrgRole },
  ) {
    await this.orgs.updateMemberRole(auth, actorOf(auth), userId, body.role);
  }

  @Delete('members/:userId')
  @OrgPermission('org.members.manage')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('userId', uuidPipe) userId: string) {
    await this.orgs.removeMember(auth, actorOf(auth), userId);
  }

  @Get('invitations')
  @OrgPermission('org.members.manage')
  invitations(@Auth() auth: AuthContext) {
    return this.orgs.listInvitations(auth.organizationId);
  }

  @Post('invitations')
  @OrgPermission('org.members.manage')
  invite(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(createInvitationSchema)) body: CreateInvitationInput,
  ) {
    return this.orgs.createInvitation(auth, actorOf(auth), body);
  }

  @Post('invitations/:id/revoke')
  @OrgPermission('org.members.manage')
  @HttpCode(204)
  async revoke(@Auth() auth: AuthContext, @Param('id', uuidPipe) id: string) {
    await this.orgs.revokeInvitation(auth, actorOf(auth), id);
  }
}
