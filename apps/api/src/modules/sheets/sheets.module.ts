import { Global, Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module.js';
import { SheetsController, SheetTemplatesController } from './sheets.controller.js';
import { SheetTemplatesService } from './sheet-templates.service.js';
import { SheetsService } from './sheets.service.js';

@Global()
@Module({ imports: [MeasurementsModule], controllers: [SheetTemplatesController, SheetsController], providers: [SheetTemplatesService, SheetsService], exports: [SheetTemplatesService] })
export class SheetsModule {}
