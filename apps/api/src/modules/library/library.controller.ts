import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  convertQuery,
  createCategorySchema,
  createUnitSchema,
  listServicesQuery,
  serviceInputSchema,
  similarQuery,
  updateCategorySchema,
  updateServiceSchema,
  updateUnitSchema,
  type CreateUnitInput,
  type ListServicesQuery,
  type ServiceInput,
  type UpdateServiceInput,
} from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, OrgPermission, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { LibraryService } from './library.service.js';

const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() });
const codeSchema = z.object({ code: serviceInputSchema.shape.code });
const projectDuplicateSchema = z.object({ sourceId: z.uuid(), code: serviceInputSchema.shape.code });

@Controller('catalog')
export class CatalogLibraryController {
  constructor(private readonly lib: LibraryService) {}

  // ----- unidades -----
  @Get('units')
  @OrgPermission('org.read')
  units(@Auth() a: AuthContext) {
    return this.lib.listUnits(a.organizationId);
  }

  @Get('units/convert')
  @OrgPermission('org.read')
  convert(@Auth() a: AuthContext, @Query(new ZodPipe(convertQuery)) q: { value: string; from: string; to: string }) {
    return this.lib.convertValue(a.organizationId, q.value, q.from, q.to);
  }

  @Post('units')
  @OrgPermission('org.manage')
  createUnit(@Auth() a: AuthContext, @Body(new ZodPipe(createUnitSchema)) b: CreateUnitInput) {
    return this.lib.createUnit(actorOf(a), b);
  }

  @Patch('units/:id')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async updateUnit(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateUnitSchema)) b: { name?: string; decimals?: number }) {
    await this.lib.updateUnit(actorOf(a), id, v, b);
  }

  @Post('units/:id/archive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async archiveUnit(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.lib.setUnitArchived(actorOf(a), id, v, true);
  }

  @Post('units/:id/unarchive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async unarchiveUnit(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.lib.setUnitArchived(actorOf(a), id, v, false);
  }

  // ----- categorias -----
  @Get('service-categories')
  @OrgPermission('org.read')
  categories(@Auth() a: AuthContext) {
    return this.lib.listCategories(a.organizationId);
  }

  @Post('service-categories')
  @OrgPermission('org.manage')
  createCategory(@Auth() a: AuthContext, @Body(new ZodPipe(createCategorySchema)) b: { code: string; name: string; parentId?: string | null }) {
    return this.lib.createCategory(actorOf(a), b);
  }

  @Patch('service-categories/:id')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async updateCategory(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateCategorySchema)) b: { name?: string; parentId?: string | null }) {
    await this.lib.updateCategory(actorOf(a), id, v, b);
  }

  @Post('service-categories/:id/archive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async archiveCategory(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.lib.archiveCategory(actorOf(a), id, v);
  }

  // ----- serviços do catálogo da organização -----
  @Get('services')
  @OrgPermission('org.read')
  list(@Auth() a: AuthContext, @Query(new ZodPipe(listServicesQuery)) q: ListServicesQuery) {
    return this.lib.list(a.organizationId, null, q);
  }

  @Get('services/similar')
  @OrgPermission('org.read')
  similar(@Auth() a: AuthContext, @Query(new ZodPipe(similarQuery)) q: { description: string; excludeId?: string }) {
    return this.lib.similar(a.organizationId, null, q.description, q.excludeId);
  }

  @Get('services/:id')
  @OrgPermission('org.read')
  get(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string) {
    return this.lib.get(a.organizationId, null, id);
  }

  @Post('services')
  @OrgPermission('org.manage')
  create(@Auth() a: AuthContext, @Body(new ZodPipe(serviceInputSchema)) b: ServiceInput) {
    return this.lib.create(actorOf(a), null, b);
  }

  @Patch('services/:id')
  @OrgPermission('org.manage')
  update(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateServiceSchema)) b: UpdateServiceInput) {
    return this.lib.update(actorOf(a), null, id, v, b);
  }

  @Post('services/:id/archive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async archive(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(reasonSchema)) b: { reason?: string }) {
    await this.lib.setArchived(actorOf(a), null, id, v, true, b.reason ?? null);
  }

  @Post('services/:id/unarchive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async unarchive(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.lib.setArchived(actorOf(a), null, id, v, false, null);
  }

  @Post('services/:id/duplicate')
  @OrgPermission('org.manage')
  duplicate(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Body(new ZodPipe(codeSchema)) b: { code: string }) {
    return this.lib.duplicate(actorOf(a), id, { projectId: null, code: b.code });
  }
}

/** Serviços no contexto de um empreendimento: catálogo da organização + específicos do empreendimento. */
@Controller('projects/:projectId/services')
export class ProjectServicesController {
  constructor(private readonly lib: LibraryService) {}

  @Get()
  @ProjectPermission('project.read')
  list(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Query(new ZodPipe(listServicesQuery)) q: ListServicesQuery) {
    return this.lib.list(a.organizationId, p, q);
  }

  @Get('similar')
  @ProjectPermission('project.read')
  similar(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Query(new ZodPipe(similarQuery)) q: { description: string; excludeId?: string }) {
    return this.lib.similar(a.organizationId, p, q.description, q.excludeId);
  }

  @Get(':id')
  @ProjectPermission('project.read')
  get(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Param('id', uuidPipe) id: string) {
    return this.lib.get(a.organizationId, p, id);
  }

  @Post()
  @ProjectPermission('project.content.edit')
  create(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Body(new ZodPipe(serviceInputSchema)) b: ServiceInput) {
    return this.lib.create(actorOf(a), p, b);
  }

  @Post('duplicate')
  @ProjectPermission('project.content.edit')
  duplicate(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Body(new ZodPipe(projectDuplicateSchema)) b: { sourceId: string; code: string }) {
    return this.lib.duplicate(actorOf(a), b.sourceId, { projectId: p, code: b.code });
  }

  @Patch(':id')
  @ProjectPermission('project.content.edit')
  update(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateServiceSchema)) b: UpdateServiceInput) {
    return this.lib.update(actorOf(a), p, id, v, b);
  }

  @Post(':id/archive')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async archive(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(reasonSchema)) b: { reason?: string }) {
    await this.lib.setArchived(actorOf(a), p, id, v, true, b.reason ?? null);
  }

  @Post(':id/unarchive')
  @ProjectPermission('project.content.edit')
  @HttpCode(204)
  async unarchive(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.lib.setArchived(actorOf(a), p, id, v, false, null);
  }
}
