import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  createElementTypeSchema,
  createSystemTypeSchema,
  updateElementTypeSchema,
  updateSystemTypeSchema,
  type CreateElementTypeInput,
  type UpdateElementTypeInput,
} from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, OrgPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('system-types')
  @OrgPermission('org.read')
  systemTypes(@Auth() auth: AuthContext) {
    return this.catalog.listSystemTypes(auth.organizationId);
  }

  @Post('system-types')
  @OrgPermission('org.manage')
  createSystemType(@Auth() auth: AuthContext, @Body(new ZodPipe(createSystemTypeSchema)) body: { code: string; name: string; networkBased: boolean }) {
    return this.catalog.createSystemType(actorOf(auth), body);
  }

  @Patch('system-types/:id')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async updateSystemType(@Auth() auth: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() version: number, @Body(new ZodPipe(updateSystemTypeSchema)) body: { name: string }) {
    await this.catalog.updateSystemType(actorOf(auth), id, version, body.name);
  }

  @Get('element-types')
  @OrgPermission('org.read')
  elementTypes(@Auth() auth: AuthContext) {
    return this.catalog.listElementTypes(auth.organizationId);
  }

  @Post('element-types')
  @OrgPermission('org.manage')
  createElementType(@Auth() auth: AuthContext, @Body(new ZodPipe(createElementTypeSchema)) body: CreateElementTypeInput) {
    return this.catalog.createElementType(actorOf(auth), body);
  }

  @Patch('element-types/:id')
  @OrgPermission('org.manage')
  updateElementType(@Auth() auth: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() version: number, @Body(new ZodPipe(updateElementTypeSchema)) body: UpdateElementTypeInput) {
    return this.catalog.updateElementType(actorOf(auth), id, version, body);
  }

  @Post('element-types/:id/archive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async archive(@Auth() auth: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() version: number) {
    await this.catalog.setElementTypeArchived(actorOf(auth), id, version, true);
  }

  @Post('element-types/:id/unarchive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async unarchive(@Auth() auth: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() version: number) {
    await this.catalog.setElementTypeArchived(actorOf(auth), id, version, false);
  }
}
