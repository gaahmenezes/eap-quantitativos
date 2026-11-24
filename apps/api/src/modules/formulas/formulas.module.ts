import { Global, Module } from '@nestjs/common';
import { FormulasController } from './formulas.controller.js';
import { FormulasService } from './formulas.service.js';

@Global()
@Module({ controllers: [FormulasController], providers: [FormulasService], exports: [FormulasService] })
export class FormulasModule {}
