import { Global, Module } from '@nestjs/common';
import { CatalogLibraryController, ProjectServicesController } from './library.controller.js';
import { LibraryService } from './library.service.js';

@Global()
@Module({ controllers: [CatalogLibraryController, ProjectServicesController], providers: [LibraryService], exports: [LibraryService] })
export class LibraryModule {}
