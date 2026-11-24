import { Global, Module } from '@nestjs/common';
import { WbsTemplatesController } from './wbs-templates.controller.js';
import { WbsTemplatesService } from './wbs-templates.service.js';

@Global()
@Module({ controllers: [WbsTemplatesController], providers: [WbsTemplatesService], exports: [WbsTemplatesService] })
export class WbsTemplatesModule {}
