import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module.js';
import { ScheduleSourcesController, SchedulesController } from './schedules.controller.js';
import { SchedulesService } from './schedules.service.js';

@Module({ imports: [MeasurementsModule], controllers: [ScheduleSourcesController, SchedulesController], providers: [SchedulesService], exports: [SchedulesService] })
export class SchedulesModule {}
