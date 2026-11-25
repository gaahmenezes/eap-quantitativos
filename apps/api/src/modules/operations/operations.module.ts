import { Module } from '@nestjs/common';
import { SchedulesModule } from '../schedules/schedules.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';

@Module({ imports: [SchedulesModule], controllers: [OperationsController], providers: [OperationsService] })
export class OperationsModule {}
