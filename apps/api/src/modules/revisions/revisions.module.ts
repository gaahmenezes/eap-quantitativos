import { Module } from '@nestjs/common';
import { ConsolidationModule } from '../consolidation/consolidation.module.js';
import { RevisionsController } from './revisions.controller.js';
import { RevisionsService } from './revisions.service.js';

@Module({ imports: [ConsolidationModule], controllers: [RevisionsController], providers: [RevisionsService] })
export class RevisionsModule {}
