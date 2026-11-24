import { Inject, Injectable } from '@nestjs/common';
import type { DocumentDto } from '@eapq/contracts';
import { checkZipLimits, FileCheckError, MIME, sniffFile, type FileKind } from '@eapq/domain';
import type { Actor } from '../../common/auth/auth-context.js';
import { AppError, notFound } from '../../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { StorageService } from './storage.service.js';

export interface UploadedFile { originalname: string; buffer: Buffer; size: number }

const invalidFile = (detail: string) => new AppError(422, 'INVALID_FILE', 'Arquivo inválido', detail, [{ path: 'file', message: detail }]);
export const safeName = (n: string) => n.normalize('NFC').replace(/[\\/\0\r\n"<>|:*?]/g, '_').slice(-200) || 'arquivo';

export const docDto = (d: { id: string; fileName: string; kind: string; mime: string; size: number; sha256: string; createdAt: Date }): DocumentDto =>
  ({ id: d.id, fileName: d.fileName, kind: d.kind as DocumentDto['kind'], mime: d.mime, size: d.size, sha256: d.sha256, createdAt: d.createdAt.toISOString() });

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Verifica o arquivo (assinatura, tamanho, zip bomb) e grava. */
  async store(tx: Tx, actor: Actor, projectId: string | null, file: UploadedFile | undefined, allowed: readonly FileKind[]) {
    if (!file || !file.size) throw invalidFile('Selecione um arquivo.');
    if (file.size > this.config.UPLOAD_MAX_MB * 1024 * 1024) throw invalidFile(`O arquivo passa de ${this.config.UPLOAD_MAX_MB} MB.`);
    let kind: FileKind;
    try {
      kind = sniffFile(file.buffer, file.originalname);
      if (kind === 'XLSX') checkZipLimits(file.buffer);
    } catch (e) {
      if (e instanceof FileCheckError) throw invalidFile(e.message);
      throw e;
    }
    if (!allowed.includes(kind)) throw invalidFile(`Tipo não aceito aqui (${kind}). Envie: ${allowed.join(', ')}.`);
    const { key, sha256 } = await this.storage.put(file.buffer);
    const d = await tx.document.create({ data: { organizationId: actor.organizationId, projectId, fileName: safeName(file.originalname), kind, mime: MIME[kind], size: file.size, sha256, storageKey: key, createdById: actor.userId } });
    await this.audit.record(tx, actor, { projectId, entityType: 'Document', entityId: d.id, action: 'CREATE', after: { fileName: d.fileName, kind, size: d.size, sha256 } });
    return d;
  }

  async upload(actor: Actor, projectId: string, file: UploadedFile | undefined): Promise<DocumentDto> {
    return docDto(await this.prisma.$transaction((tx) => this.store(tx, actor, projectId, file, ['PDF', 'PNG', 'JPEG', 'XLSX', 'CSV'])));
  }

  async forDownload(organizationId: string, projectId: string | null, id: string) {
    const d = await this.prisma.document.findFirst({ where: { id, organizationId, projectId } });
    if (!d) throw notFound('Documento');
    return { doc: d, stream: this.storage.stream(d.storageKey) };
  }
}
