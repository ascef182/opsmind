import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { Task } from '@opsmind/database';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

// Mesma política de RBAC de customers: leitura aberta a qualquer membro,
// escrita exige papel acima de VIEWER.
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateTaskDto,
  ): Promise<Task> {
    return this.tasksService.create(organizationId, dto, { type: 'USER', id: user.id });
  }

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query() query: ListTasksQueryDto,
  ): Promise<Task[]> {
    return this.tasksService.list(organizationId, query);
  }

  @Get(':taskId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('taskId') taskId: string,
  ): Promise<Task> {
    return this.tasksService.findByIdOrThrow(organizationId, taskId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch(':taskId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('taskId') taskId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateTaskDto,
  ): Promise<Task> {
    return this.tasksService.update(organizationId, taskId, dto, user.id);
  }
}
