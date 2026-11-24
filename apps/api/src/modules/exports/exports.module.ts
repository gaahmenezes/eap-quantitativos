import { Module } from '@nestjs/common';
import { ConsolidationModule } from '../consolidation/consolidation.module.js';
import { RevisionsModule } from '../revisions/revisions.module.js';
import { ExportsController } from './exports.controller.js';
import { ExportsService } from './exports.service.js';

@Module({ imports: [ConsolidationModule, RevisionsModule], controllers: [ExportsController], providers: [ExportsService] })
export class ExportsModule {}
