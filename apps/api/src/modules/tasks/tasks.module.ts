import { Global, Module } from '@nestjs/common';
import { MyTasksController, TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Global()
@Module({ controllers: [MyTasksController, TasksController], providers: [TasksService], exports: [TasksService] })
export class TasksModule {}
