import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { importApplySchema, importKindSchema, importMappingSchema, importRowsQuery, type ImportMappingInput } from '@eapq/contracts';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, OrgPermission, ProjectPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { uploadInterceptor } from '../documents/documents.controller.js';
import type { UploadedFile as File } from '../documents/documents.service.js';
import { ImportsService } from './imports.service.js';

const kindBody = z.object({ kind: importKindSchema });

/** Importação de serviços para o catálogo da organização. */
@Controller('imports')
export class OrgImportsController {
  constructor(private readonly svc: ImportsService) {}
  private scope = (a: AuthContext) => ({ organizationId: a.organizationId, projectId: null });

  @Get() @OrgPermission('org.read')
  list(@Auth() a: AuthContext) { return this.svc.list(this.scope(a)); }

  @Post() @OrgPermission('org.manage') @UseInterceptors(uploadInterceptor())
  create(@Auth() a: AuthContext, @Body(new ZodPipe(kindBody)) b: z.infer<typeof kindBody>, @UploadedFile() f: File | undefined) { return this.svc.create(actorOf(a), this.scope(a), b.kind, f); }

  @Get(':id') @OrgPermission('org.read')
  get(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string) { return this.svc.get(this.scope(a), id); }

  @Get(':id/rows') @OrgPermission('org.read')
  rows(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Query(new ZodPipe(importRowsQuery)) q: z.infer<typeof importRowsQuery>) { return this.svc.rows(this.scope(a), id, q); }

  @Put(':id/mapping') @OrgPermission('org.manage')
  map(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(importMappingSchema)) b: ImportMappingInput) { return this.svc.map(actorOf(a), this.scope(a), id, v, b); }

  @Post(':id/apply') @OrgPermission('org.manage') @HttpCode(200)
  apply(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(importApplySchema)) b: z.infer<typeof importApplySchema>) { return this.svc.apply(actorOf(a), this.scope(a), id, v, b.skipInvalid); }

  @Post(':id/cancel') @OrgPermission('org.manage') @HttpCode(204)
  async cancel(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string) { await this.svc.cancel(actorOf(a), this.scope(a), id); }
}

/** Importação de serviços específicos, cadastro físico e medições de um empreendimento. */
@Controller('projects/:projectId/imports')
export class ProjectImportsController {
  constructor(private readonly svc: ImportsService) {}
  private scope = (a: AuthContext, p: string) => ({ organizationId: a.organizationId, projectId: p });

  @Get() @ProjectPermission('project.read')
  list(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string) { return this.svc.list(this.scope(a, p)); }

  @Post() @ProjectPermission('project.content.edit') @UseInterceptors(uploadInterceptor())
  create(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Body(new ZodPipe(kindBody)) b: z.infer<typeof kindBody>, @UploadedFile() f: File | undefined) { return this.svc.create(actorOf(a), this.scope(a, p), b.kind, f); }

  @Get(':id') @ProjectPermission('project.read')
  get(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Param('id', uuidPipe) id: string) { return this.svc.get(this.scope(a, p), id); }

  @Get(':id/rows') @ProjectPermission('project.read')
  rows(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Param('id', uuidPipe) id: string, @Query(new ZodPipe(importRowsQuery)) q: z.infer<typeof importRowsQuery>) { return this.svc.rows(this.scope(a, p), id, q); }

  @Put(':id/mapping') @ProjectPermission('project.content.edit')
  map(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(importMappingSchema)) b: ImportMappingInput) { return this.svc.map(actorOf(a), this.scope(a, p), id, v, b); }

  @Post(':id/apply') @ProjectPermission('project.content.edit') @HttpCode(200)
  apply(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(importApplySchema)) b: z.infer<typeof importApplySchema>) { return this.svc.apply(actorOf(a), this.scope(a, p), id, v, b.skipInvalid); }

  @Post(':id/cancel') @ProjectPermission('project.content.edit') @HttpCode(204)
  async cancel(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Param('id', uuidPipe) id: string) { await this.svc.cancel(actorOf(a), this.scope(a, p), id); }
}
