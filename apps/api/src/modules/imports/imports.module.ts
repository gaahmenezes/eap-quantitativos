import { Module } from '@nestjs/common';
import { OrgImportsController, ProjectImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

@Module({ controllers: [OrgImportsController, ProjectImportsController], providers: [ImportsService] })
export class ImportsModule {}
