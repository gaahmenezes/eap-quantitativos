import { Module } from '@nestjs/common';
import { StructureController } from './structure.controller.js';
import { StructureService } from './structure.service.js';
import { TypologiesService } from './typologies.service.js';

@Module({ controllers: [StructureController], providers: [StructureService, TypologiesService] })
export class StructureModule {}
