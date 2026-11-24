import { Global, Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { StorageService } from './storage.service.js';

@Global()
@Module({ controllers: [DocumentsController], providers: [DocumentsService, StorageService], exports: [DocumentsService, StorageService] })
export class DocumentsModule {}
