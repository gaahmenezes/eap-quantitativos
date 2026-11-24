import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  createFormulaSchema,
  evaluateFormulaSchema,
  updateFormulaSchema,
  updateFormulaVersionSchema,
  type CreateFormulaInput,
  type UpdateFormulaVersionInput,
} from '@eapq/contracts';
import type { FormulaDef, FormulaInput } from '@eapq/domain';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, OrgPermission } from '../../common/auth/decorators.js';
import { IfMatch } from '../../common/if-match.js';
import { uuidPipe, ZodPipe } from '../../common/zod.pipe.js';
import { FormulasService } from './formulas.service.js';

@Controller('formulas')
export class FormulasController {
  constructor(private readonly svc: FormulasService) {}

  @Get()
  @OrgPermission('org.read')
  list(@Auth() a: AuthContext) {
    return this.svc.list(a.organizationId);
  }

  @Post()
  @OrgPermission('org.manage')
  create(@Auth() a: AuthContext, @Body(new ZodPipe(createFormulaSchema)) b: CreateFormulaInput) {
    return this.svc.create(actorOf(a), b);
  }

  @Post('evaluate')
  @OrgPermission('org.read')
  @HttpCode(200)
  evaluate(@Auth() a: AuthContext, @Body(new ZodPipe(evaluateFormulaSchema)) b: FormulaDef & { inputs: FormulaInput[]; unit: string }) {
    return this.svc.evaluate(a.organizationId, b);
  }

  @Patch(':id')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async update(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number, @Body(new ZodPipe(updateFormulaSchema)) b: { name?: string; description?: string | null }) {
    await this.svc.update(actorOf(a), id, v, b);
  }

  @Post(':id/archive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async archive(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.svc.setArchived(actorOf(a), id, v, true);
  }

  @Post(':id/unarchive')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async unarchive(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @IfMatch() v: number) {
    await this.svc.setArchived(actorOf(a), id, v, false);
  }

  @Post(':id/versions')
  @OrgPermission('org.manage')
  newVersion(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string) {
    return this.svc.newVersion(actorOf(a), id);
  }

  @Patch(':id/versions/:versionId')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async updateVersion(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) vid: string, @Body(new ZodPipe(updateFormulaVersionSchema)) b: UpdateFormulaVersionInput) {
    await this.svc.updateVersion(actorOf(a), id, vid, b);
  }

  @Delete(':id/versions/:versionId')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async discard(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) vid: string) {
    await this.svc.discard(actorOf(a), id, vid);
  }

  @Post(':id/versions/:versionId/publish')
  @OrgPermission('org.manage')
  @HttpCode(204)
  async publish(@Auth() a: AuthContext, @Param('id', uuidPipe) id: string, @Param('versionId', uuidPipe) vid: string) {
    await this.svc.publish(actorOf(a), id, vid);
  }
}
