import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module.js';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { WorkbooksController } from './workbooks.controller.js';
import { WorkbooksService } from './workbooks.service.js';

@Module({ imports: [DocumentsModule, SchedulesModule], controllers: [WorkbooksController], providers: [WorkbooksService] })
export class WorkbooksModule {}
