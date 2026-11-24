import { Injectable } from '@nestjs/common';
import type { CreateFormulaInput, FormulaDto, FormulaVariableInput, UpdateFormulaVersionInput } from '@eapq/contracts';
import { DEFAULT_FORMULAS, describeDimension, evaluateFormula, FormulaError, validateFormula, type FormulaDef, type FormulaInput } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import type { FormulaVersion } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { loadUnits } from './units.js';

const TX = { timeout: 30_000 } as const;
export const formulaInvalid = (issues: { path: string; message: string }[]) =>
  new AppError(422, 'FORMULA_INVALID', 'Fórmula inválida', issues.map((i) => i.message).join(' '), issues);

const defOf = (v: Pick<FormulaVersion, 'expression' | 'variables'>): FormulaDef => ({ expression: v.expression, variables: v.variables as unknown as FormulaVariableInput[] });

@Injectable()
export class FormulasService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Fórmulas iniciais publicadas (exemplos editáveis). Exige as unidades da organização. */
  async ensureDefaults(tx: Tx, organizationId: string) {
    if ((await tx.formula.count({ where: { organizationId } })) > 0) return;
    const units = await loadUnits(tx, organizationId);
    if (!units.length) return;
    for (const f of DEFAULT_FORMULAS) {
      const a = validateFormula(f, units);
      if (a.issues.length || !a.resultDimension) continue; // unidade padrão removida pela organização
      const row = await tx.formula.create({ data: { organizationId, code: f.code, name: f.name, description: f.description } });
      await tx.formulaVersion.create({
        data: { organizationId, formulaId: row.id, number: 1, status: 'PUBLISHED', publishedAt: new Date(), expression: f.expression, variables: f.variables as object[], dimL: a.resultDimension.L, dimM: a.resultDimension.M, dimT: a.resultDimension.T, notes: 'Fórmula inicial (exemplo editável).' },
      });
    }
  }

  async list(organizationId: string): Promise<FormulaDto[]> {
    if ((await this.prisma.formula.count({ where: { organizationId } })) === 0) await this.prisma.$transaction((tx) => this.ensureDefaults(tx, organizationId), TX);
    const [rows, units, usage] = await Promise.all([
      this.prisma.formula.findMany({ where: { organizationId }, orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { code: 'asc' }], include: { versions: { orderBy: { number: 'desc' } } } }),
      loadUnits(this.prisma, organizationId),
      this.prisma.$queryRaw<{ formulaVersionId: string; n: bigint }[]>`
        SELECT r."formulaVersionId", count(*) AS n FROM measurement m
        JOIN measurement_revision r ON r."measurementId" = m.id AND r.number = m."currentNumber"
        WHERE m."organizationId" = ${organizationId}::uuid AND m."archivedAt" IS NULL AND r."formulaVersionId" IS NOT NULL
        GROUP BY r."formulaVersionId"`,
    ]);
    const used = new Map(usage.map((u) => [u.formulaVersionId, Number(u.n)]));
    return rows.map((f) => ({
      id: f.id, code: f.code, name: f.name, description: f.description, archivedAt: f.archivedAt?.toISOString() ?? null, version: f.version,
      versions: f.versions.map((v) => {
        const analysis = v.status === 'DRAFT' ? validateFormula(defOf(v), units) : null;
        const dim = v.dimL === null ? analysis?.resultDimension ?? null : { L: v.dimL, M: v.dimM!, T: v.dimT!, N: 0 };
        return {
          id: v.id, number: v.number, status: v.status, expression: v.expression, variables: v.variables as unknown as FormulaVariableInput[],
          resultDimension: dim, resultDescription: dim ? describeDimension(dim) : null, notes: v.notes,
          publishedAt: v.publishedAt?.toISOString() ?? null, createdAt: v.createdAt.toISOString(), measurementCount: used.get(v.id) ?? 0,
          issues: analysis?.issues ?? [],
        };
      }),
    }));
  }

  private async formula(tx: Tx, organizationId: string, id: string) {
    const f = await tx.formula.findFirst({ where: { id, organizationId } });
    if (!f) throw notFound('Fórmula');
    return f;
  }

  private async draft(tx: Tx, organizationId: string, formulaId: string, versionId: string) {
    const v = await tx.formulaVersion.findFirst({ where: { id: versionId, formulaId, organizationId } });
    if (!v) throw notFound('Versão da fórmula');
    if (v.status !== 'DRAFT') throw conflict('VERSION_PUBLISHED', `A R${v.number} já foi publicada e não pode ser alterada. Crie uma nova versão.`);
    return v;
  }

  async create(actor: Actor, input: CreateFormulaInput) {
    return this.prisma.$transaction(async (tx) => {
      const dup = await tx.formula.findUnique({ where: { organizationId_code: { organizationId: actor.organizationId, code: input.code } } });
      if (dup) throw conflict('CODE_IN_USE', `Já existe a fórmula ${input.code}.`);
      const f = await tx.formula.create({ data: { organizationId: actor.organizationId, code: input.code, name: input.name, description: input.description ?? null } });
      const v = await tx.formulaVersion.create({ data: { organizationId: actor.organizationId, formulaId: f.id, number: 1, expression: input.expression, variables: input.variables as object[] } });
      await this.audit.record(tx, actor, { entityType: 'Formula', entityId: f.id, action: 'CREATE', after: input });
      return { id: f.id, versionId: v.id };
    });
  }

  async update(actor: Actor, id: string, version: number, input: { name?: string; description?: string | null }) {
    await this.prisma.$transaction(async (tx) => {
      const f = await this.formula(tx, actor.organizationId, id);
      const r = await tx.formula.updateMany({ where: { id, version }, data: { ...input, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'Formula', entityId: id, action: 'UPDATE', before: { name: f.name, description: f.description }, after: input });
    });
  }

  async setArchived(actor: Actor, id: string, version: number, archived: boolean) {
    await this.prisma.$transaction(async (tx) => {
      await this.formula(tx, actor.organizationId, id);
      const r = await tx.formula.updateMany({ where: { id, version }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
      if (r.count === 0) throw versionConflict();
      await this.audit.record(tx, actor, { entityType: 'Formula', entityId: id, action: archived ? 'ARCHIVE' : 'UNARCHIVE' });
    });
  }

  async newVersion(actor: Actor, formulaId: string) {
    return this.prisma.$transaction(async (tx) => {
      const f = await this.formula(tx, actor.organizationId, formulaId);
      if (f.archivedAt) throw conflict('ARCHIVED', 'Fórmula arquivada. Reative-a antes de criar uma versão.');
      const last = await tx.formulaVersion.findFirst({ where: { formulaId }, orderBy: { number: 'desc' } });
      if (last?.status === 'DRAFT') throw conflict('DRAFT_EXISTS', `Já existe a R${last.number} em elaboração.`);
      const v = await tx.formulaVersion.create({ data: { organizationId: actor.organizationId, formulaId, number: (last?.number ?? 0) + 1, expression: last?.expression ?? '', variables: (last?.variables ?? []) as object[] } });
      await this.audit.record(tx, actor, { entityType: 'FormulaVersion', entityId: v.id, action: 'CREATE', after: { formulaId, number: v.number } });
      return { id: v.id };
    });
  }

  async updateVersion(actor: Actor, formulaId: string, versionId: string, input: UpdateFormulaVersionInput) {
    await this.prisma.$transaction(async (tx) => {
      await this.formula(tx, actor.organizationId, formulaId);
      const v = await this.draft(tx, actor.organizationId, formulaId, versionId);
      await tx.formulaVersion.update({ where: { id: v.id }, data: { ...(input.expression !== undefined && { expression: input.expression }), ...(input.variables && { variables: input.variables as object[] }), ...(input.notes !== undefined && { notes: input.notes }) } });
      await this.audit.record(tx, actor, { entityType: 'FormulaVersion', entityId: v.id, action: 'UPDATE', before: { expression: v.expression, variables: v.variables }, after: input });
    });
  }

  async discard(actor: Actor, formulaId: string, versionId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.formula(tx, actor.organizationId, formulaId);
      const v = await this.draft(tx, actor.organizationId, formulaId, versionId);
      if (!(await tx.formulaVersion.count({ where: { formulaId, status: 'PUBLISHED' } }))) throw conflict('LAST_VERSION', 'A fórmula ainda não tem versão publicada; edite o rascunho ou arquive a fórmula.');
      await tx.formulaVersion.delete({ where: { id: v.id } });
      await this.audit.record(tx, actor, { entityType: 'FormulaVersion', entityId: v.id, action: 'DELETE', before: { number: v.number } });
    });
  }

  async publish(actor: Actor, formulaId: string, versionId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.formula(tx, actor.organizationId, formulaId);
      const v = await this.draft(tx, actor.organizationId, formulaId, versionId);
      const a = validateFormula(defOf(v), await loadUnits(tx, actor.organizationId));
      if (a.issues.length || !a.resultDimension) throw formulaInvalid(a.issues);
      await tx.formulaVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), publishedById: actor.userId, dimL: a.resultDimension.L, dimM: a.resultDimension.M, dimT: a.resultDimension.T } });
      await this.audit.record(tx, actor, { entityType: 'FormulaVersion', entityId: v.id, action: 'PUBLISH', after: { number: v.number, expression: v.expression } });
    }, TX);
  }

  /** Teste da fórmula sem gravar nada. */
  async evaluate(organizationId: string, input: FormulaDef & { inputs: FormulaInput[]; unit: string }) {
    const units = await loadUnits(this.prisma, organizationId);
    const target = units.find((u) => u.symbol === input.unit);
    if (!target) throw formulaInvalid([{ path: 'unit', message: `Unidade não cadastrada: ${input.unit}.` }]);
    try {
      const r = evaluateFormula(input, input.inputs, units, target);
      return { quantity: r.quantity, unit: target.symbol, memory: r.memory };
    } catch (e) {
      if (e instanceof FormulaError) throw formulaInvalid(e.issues);
      throw e;
    }
  }
}
