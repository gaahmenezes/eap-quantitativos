import { Controller, Get, Param, Post, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { actorOf, type AuthContext } from '../../common/auth/auth-context.js';
import { Auth, ProjectPermission } from '../../common/auth/decorators.js';
import { uuidPipe } from '../../common/zod.pipe.js';
import { DocumentsService, type UploadedFile as File } from './documents.service.js';

/** Upload em memória com limite rígido (o tamanho configurado é verificado de novo no serviço). */
export const uploadInterceptor = () => FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 10 } });

export function sendFile(res: Response, doc: { fileName: string; mime: string; size: number }, inline = false) {
  res.setHeader('Content-Type', doc.mime);
  res.setHeader('Content-Length', String(doc.size));
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
}

@Controller('projects/:projectId/documents')
export class DocumentsController {
  constructor(private readonly svc: DocumentsService) {}

  @Post()
  @ProjectPermission('project.content.edit')
  @UseInterceptors(uploadInterceptor())
  upload(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @UploadedFile() file: File | undefined) {
    return this.svc.upload(actorOf(a), p, file);
  }

  @Get(':id')
  @ProjectPermission('project.read')
  async download(@Auth() a: AuthContext, @Param('projectId', uuidPipe) p: string, @Param('id', uuidPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { doc, stream } = await this.svc.forDownload(a.organizationId, p, id);
    sendFile(res, doc);
    return new StreamableFile(stream);
  }
}
