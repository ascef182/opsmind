import { Injectable } from '@nestjs/common';
import type { Task, TaskStatus } from '@opsmind/database';
import { TasksService } from '../../tasks/tasks.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface ListTasksInput {
  status?: TaskStatus;
  assigneeId?: string;
  customerId?: string;
}

@Injectable()
export class ListTasksTool implements AiTool<ListTasksInput> {
  readonly name = 'list_tasks';
  readonly description = 'Lista tarefas do workspace, opcionalmente filtradas por status, responsável ou cliente.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] },
      assigneeId: { type: 'string', format: 'uuid' },
      customerId: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  };

  constructor(private readonly tasksService: TasksService) {}

  execute(input: ListTasksInput, context: AiToolContext): Promise<Task[]> {
    return this.tasksService.list(context.organizationId, {
      status: input.status,
      assigneeId: input.assigneeId,
      customerId: input.customerId,
    });
  }
}
