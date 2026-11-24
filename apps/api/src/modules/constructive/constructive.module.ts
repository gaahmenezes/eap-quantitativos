import { Module } from '@nestjs/common';
import { ConstructiveController } from './constructive.controller.js';
import { ConstructiveService } from './constructive.service.js';

@Module({ controllers: [ConstructiveController], providers: [ConstructiveService] })
export class ConstructiveModule {}
