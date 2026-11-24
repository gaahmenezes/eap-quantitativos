import { Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AccessGuard } from './common/auth/access.guard.js';
import { SessionService } from './common/auth/session.service.js';
import { ProblemFilter } from './common/problem.filter.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { HealthController } from './health.controller.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { StructureModule } from './modules/structure/structure.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InfrastructureModule } from './modules/infrastructure/infrastructure.module.js';
import { ConstructiveModule } from './modules/constructive/constructive.module.js';
import { LibraryModule } from './modules/library/library.module.js';
import { WbsTemplatesModule } from './modules/wbs-templates/wbs-templates.module.js';
import { WbsModule } from './modules/wbs/wbs.module.js';
import { PrismaService } from './prisma/prisma.service.js';

@Global()
@Module({})
class CoreModule {
  static forConfig(config: AppConfig) {
    return {
      module: CoreModule,
      providers: [{ provide: APP_CONFIG, useValue: config }, PrismaService, SessionService],
      exports: [APP_CONFIG, PrismaService, SessionService],
    };
  }
}

function requestId(req: Request & { id?: string }, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

@Module({})
export class AppModule implements NestModule {
  static forConfig(config: AppConfig) {
    return {
      module: AppModule,
      imports: [
        CoreModule.forConfig(config),
        // Limite global generoso; rotas de autenticação têm limites próprios.
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 600 }],
          skipIf: () => !config.RATE_LIMIT_ENABLED,
        }),
        AuditModule,
        AuthModule,
        OrganizationsModule,
        ProjectsModule,
        StructureModule,
        CatalogModule,
        InfrastructureModule,
        ConstructiveModule,
        LibraryModule,
        WbsTemplatesModule,
        WbsModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestId).forRoutes('*path');
  }
}
