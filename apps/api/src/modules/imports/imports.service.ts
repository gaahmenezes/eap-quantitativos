import { Injectable } from '@nestjs/common';
import type { ImportJobDto, ImportKindDto, ImportRowDto } from '@eapq/contracts';
import { IMPORT_FIELDS, suggestMapping } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, conflict, notFound, versionConflict } from '../../common/errors.js';
import { assertProjectEditable } from '../../common/project-guard.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DocumentsService, type UploadedFile } from '../documents/documents.service.js';
import { StorageService } from '../documents/storage.service.js';
import { IMPORTERS, type ImportScope, type RowIn, type RowOut } from './importers.js';
import { readTable } from './table.js';

const TX = { timeout: 300_000 } as const;
type Job = Prisma.ImportJobGetPayload<{ include: { document: true } }>;
const lock = (tx: Tx, scope: ImportScope) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope.projectId ? `wbs:${scope.projectId}` : `org-import:${scope.organizationId}`}, 0))`;

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docs: DocumentsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private kindAllowed(scope: ImportScope, kind: ImportKindDto) {
    if (!scope.projectId && kind !== 'SERVICES') throw new AppError(422, 'VALIDATION_FAILED', 'Dados inválidos', 'Fora de um empreendimento só é possível importar serviços do catálogo.');
  }

  private async writeRows(tx: Tx, jobId: string, rows: string[][]) {
    await tx.importRow.deleteMany({ where: { jobId } });
    const data = rows.slice(1).map((values, i) => ({ jobId, rowNumber: i + 2, values }));
    for (let i = 0; i < data.length; i += 2000) await tx.importRow.createMany({ data: data.slice(i, i + 2000) });
  }

  /** Etapas 1–3: tipo, envio do arquivo e leitura (cabeçalho + linhas na área de preparação). */
  async create(actor: Actor, scope: ImportScope, kind: ImportKindDto, file: UploadedFile | undefined): Promise<ImportJobDto> {
    this.kindAllowed(scope, kind);
    const id = await this.prisma.$transaction(async (tx) => {
      if (scope.projectId) await assertProjectEditable(tx, actor.organizationId, scope.projectId);
      const doc = await this.docs.store(tx, actor, scope.projectId, file, ['XLSX', 'CSV']);
      const table = await readTable(doc.kind, file!.buffer);
      if (table.rows.length < 2) throw new AppError(422, 'INVALID_FILE', 'Arquivo inválido', 'A planilha precisa de uma linha de cabeçalho e ao menos uma linha de dados.');
      const headers = table.rows[0]!;
      const job = await tx.importJob.create({ data: { organizationId: actor.organizationId, projectId: scope.projectId, kind, documentId: doc.id, sheets: table.sheets, sheet: table.sheet, headers, mapping: suggestMapping(headers, IMPORT_FIELDS[kind]), createdById: actor.userId } });
      await this.writeRows(tx, job.id, table.rows);
      await this.audit.record(tx, actor, { projectId: scope.projectId, entityType: 'ImportJob', entityId: job.id, action: 'CREATE', after: { kind, fileName: doc.fileName, rows: table.rows.length - 1 } });
      return job.id;
    }, TX);
    return this.get(scope, id);
  }

  private async job(tx: Tx, scope: ImportScope, id: string): Promise<Job> {
    const j = await tx.importJob.findFirst({ where: { id, organizationId: scope.organizationId, projectId: scope.projectId }, include: { document: true } });
    if (!j) throw notFound('Importação');
    return j;
  }

  async list(scope: ImportScope): Promise<ImportJobDto[]> {
    const jobs = await this.prisma.importJob.findMany({ where: { organizationId: scope.organizationId, projectId: scope.projectId }, orderBy: { createdAt: 'desc' }, take: 30, include: { document: true } });
    return Promise.all(jobs.map((j) => this.dto(j, false)));
  }

  async get(scope: ImportScope, id: string): Promise<ImportJobDto> {
    return this.dto(await this.job(this.prisma, scope, id), true);
  }

  private async dto(j: Job, withSample: boolean): Promise<ImportJobDto> {
    const [count, sample, user] = await Promise.all([
      this.prisma.importRow.count({ where: { jobId: j.id } }),
      withSample ? this.prisma.importRow.findMany({ where: { jobId: j.id }, orderBy: { rowNumber: 'asc' }, take: 5 }) : [],
      this.prisma.user.findUnique({ where: { id: j.createdById }, select: { name: true } }),
    ]);
    const fields = IMPORT_FIELDS[j.kind];
    return {
      id: j.id, kind: j.kind, status: j.status, fileName: j.document.fileName, sheets: j.sheets as string[], sheet: j.sheet, headers: j.headers as string[],
      sample: sample.map((r) => r.values as string[]), rowCount: count, fields: fields.map((f) => ({ key: f.key, label: f.label, required: f.required })),
      mapping: (j.mapping as Record<string, number | null>) ?? {}, summary: j.summary as ImportJobDto['summary'],
      createdAt: j.createdAt.toISOString(), appliedAt: j.appliedAt?.toISOString() ?? null, createdBy: user?.name ?? '—', version: j.version,
    };
  }

  private rowsIn(rows: { rowNumber: number; values: Prisma.JsonValue }[], mapping: Record<string, number | null>): RowIn[] {
    return rows.map((r) => {
      const values = r.values as string[];
      return { rowNumber: r.rowNumber, get: (f: string) => { const i = mapping[f]; return i === null || i === undefined ? '' : (values[i] ?? '').trim(); } };
    });
  }

  private async validateAll(tx: Tx, scope: ImportScope, j: Job, mapping: Record<string, number | null>): Promise<RowOut[]> {
    const rows = await tx.importRow.findMany({ where: { jobId: j.id }, orderBy: { rowNumber: 'asc' }, select: { rowNumber: true, values: true } });
    return IMPORTERS[j.kind].validate(tx, scope, this.rowsIn(rows, mapping));
  }

  private async saveResults(tx: Tx, jobId: string, results: RowOut[]) {
    for (let i = 0; i < results.length; i += 2000) {
      const c = results.slice(i, i + 2000);
      await tx.$executeRaw`
        UPDATE import_row r SET status = v.status::"ImportRowStatus", messages = v.messages::jsonb, data = v.data::jsonb
        FROM unnest(${c.map((x) => x.rowNumber)}::int[], ${c.map((x) => x.status)}::text[], ${c.map((x) => JSON.stringify(x.messages))}::text[], ${c.map((x) => (x.data ? JSON.stringify(x.data) : null))}::text[]) AS v(n, status, messages, data)
        WHERE r."jobId" = ${jobId}::uuid AND r."rowNumber" = v.n`;
    }
  }

  private summary(results: RowOut[]) {
    return { valid: results.filter((r) => r.status === 'VALID').length, warning: results.filter((r) => r.status === 'WARNING').length, error: results.filter((r) => r.status === 'ERROR').length };
  }

  /** Etapas 4–6: aba, mapeamento de colunas e validação (nada é gravado fora da área de preparação). */
  async map(actor: Actor, scope: ImportScope, id: string, version: number, input: { sheet?: string; mapping: Record<string, number | null> }): Promise<ImportJobDto> {
    await this.prisma.$transaction(async (tx) => {
      const j = await this.job(tx, scope, id);
      if (j.status === 'APPLIED' || j.status === 'CANCELLED') throw conflict('IMPORT_CLOSED', 'Esta importação já foi encerrada.');
      if (j.version !== version) throw versionConflict();
      const fields = IMPORT_FIELDS[j.kind];
      let headers = j.headers as string[];
      let sheet = j.sheet;
      if (input.sheet && input.sheet !== j.sheet) {
        const table = await readTable(j.document.kind, await this.storage.read(j.document.storageKey), input.sheet);
        headers = table.rows[0] ?? [];
        sheet = table.sheet;
        await this.writeRows(tx, j.id, table.rows);
      }
      const mapping = Object.fromEntries(fields.map((f) => [f.key, input.mapping[f.key] ?? null]));
      const issues = fields.filter((f) => f.required && (mapping[f.key] === null || mapping[f.key]! >= headers.length)).map((f) => ({ path: `mapping.${f.key}`, message: `Indique a coluna de "${f.label}".` }));
      const cols = Object.values(mapping).filter((x): x is number => x !== null);
      if (new Set(cols).size !== cols.length) issues.push({ path: 'mapping', message: 'A mesma coluna foi usada em dois campos.' });
      if (issues.length) throw new AppError(422, 'VALIDATION_FAILED', 'Mapeamento incompleto', issues.map((i) => i.message).join(' '), issues);
      const results = await this.validateAll(tx, scope, { ...j, headers }, mapping);
      await this.saveResults(tx, j.id, results);
      await tx.importJob.update({ where: { id: j.id }, data: { sheet, headers, mapping, summary: this.summary(results), status: 'VALIDATED', version: { increment: 1 } } });
    }, TX);
    return this.get(scope, id);
  }

  async rows(scope: ImportScope, id: string, q: { status?: 'VALID' | 'WARNING' | 'ERROR'; limit: number; offset: number }): Promise<{ total: number; rows: ImportRowDto[] }> {
    const j = await this.job(this.prisma, scope, id);
    const where = { jobId: j.id, ...(q.status && { status: q.status }) };
    const [total, rows] = await Promise.all([
      this.prisma.importRow.count({ where }),
      this.prisma.importRow.findMany({ where, orderBy: { rowNumber: 'asc' }, take: q.limit, skip: q.offset }),
    ]);
    return { total, rows: rows.map((r) => ({ rowNumber: r.rowNumber, values: r.values as string[], status: r.status, messages: r.messages as string[] })) };
  }

  /** Etapas 7–9: confirmação, gravação numa única transação e relatório. Revalida tudo sob lock. */
  async apply(actor: Actor, scope: ImportScope, id: string, version: number, skipInvalid: boolean): Promise<ImportJobDto> {
    await this.prisma.$transaction(async (tx) => {
      if (scope.projectId) await assertProjectEditable(tx, actor.organizationId, scope.projectId);
      await lock(tx, scope);
      const j = await this.job(tx, scope, id);
      if (j.status !== 'VALIDATED') throw conflict('IMPORT_NOT_VALIDATED', j.status === 'APPLIED' ? 'Esta importação já foi aplicada.' : 'Valide o mapeamento antes de confirmar.');
      if (j.version !== version) throw versionConflict();
      const results = await this.validateAll(tx, scope, j, j.mapping as Record<string, number | null>);
      await this.saveResults(tx, j.id, results);
      const errors = results.filter((r) => r.status === 'ERROR');
      const ok = results.filter((r) => r.status !== 'ERROR');
      if (errors.length && !skipInvalid) {
        throw new AppError(422, 'IMPORT_HAS_ERRORS', 'Há linhas com erro', `${errors.length} linha(s) com erro. Corrija o arquivo ou confirme ignorando essas linhas.`, errors.slice(0, 20).map((e) => ({ path: `rows.${e.rowNumber}`, message: `Linha ${e.rowNumber}: ${e.messages.join(' ')}` })));
      }
      if (!ok.length) throw new AppError(422, 'IMPORT_EMPTY', 'Nada a importar', 'Nenhuma linha válida.');
      const created = await IMPORTERS[j.kind].apply(tx, actor, scope, ok, { jobId: j.id, fileName: j.document.fileName }, this.audit);
      const summary = { ...this.summary(results), created, skipped: errors.length };
      await tx.importJob.update({ where: { id: j.id }, data: { status: 'APPLIED', appliedAt: new Date(), summary, version: { increment: 1 } } });
      await this.audit.record(tx, actor, { projectId: scope.projectId, entityType: 'ImportJob', entityId: j.id, action: 'APPLY', after: summary });
    }, TX);
    return this.get(scope, id);
  }

  async cancel(actor: Actor, scope: ImportScope, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const j = await this.job(tx, scope, id);
      if (j.status === 'APPLIED' || j.status === 'CANCELLED') throw conflict('IMPORT_CLOSED', 'Esta importação já foi encerrada.');
      await tx.importJob.update({ where: { id: j.id }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      await tx.importRow.deleteMany({ where: { jobId: j.id } });
      await this.audit.record(tx, actor, { projectId: scope.projectId, entityType: 'ImportJob', entityId: j.id, action: 'CANCEL' });
    });
  }
}
