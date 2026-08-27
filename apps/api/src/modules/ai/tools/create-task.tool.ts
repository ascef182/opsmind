import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Task } from '@opsmind/database';
import { TasksService } from '../../tasks/tasks.service';
import { WRITE_ROLES } from '../../../shared/constants/roles.constant';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface CreateTaskInput {
  title: string;
  description?: string;
  customerId?: string;
  assigneeId?: string;
  dueDate?: string;
}

/**
 * Única tool de escrita da Fase 3. `TaskActor.type = 'AI'` (nunca 'USER')
 * porque quem age de fato é o assistente, não o humano — mas `actorId`
 * continua sendo o usuário que invocou a IA, para o audit trail sempre poder
 * responder "em nome de quem". Checa `WRITE_ROLES` aqui, mesmo o endpoint
 * de chat não tendo `@Roles()` no controller (qualquer membro pode conversar
 * com a IA e pedir para ela ler dados; só a ação de escrita em si exige o
 * mesmo papel mínimo que a rota humana equivalente exigiria) — a IA nunca
 * pode fazer por um VIEWER o que o próprio VIEWER não poderia fazer.
 */
@Injectable()
export class CreateTaskTool implements AiTool<CreateTaskInput> {
  readonly name = 'create_task';
  readonly description = 'Cria uma nova tarefa, opcionalmente vinculada a um cliente e/ou responsável.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      customerId: { type: 'string', format: 'uuid' },
      assigneeId: { type: 'string', format: 'uuid' },
      dueDate: { type: 'string', format: 'date-time' },
    },
    required: ['title'],
    additionalProperties: false,
  };

  constructor(private readonly tasksService: TasksService) {}

  async execute(input: CreateTaskInput, context: AiToolContext): Promise<Task> {
    if (!(WRITE_ROLES as readonly string[]).includes(context.role)) {
      throw new ForbiddenException(
        'Seu papel nesta organização não permite criar tarefas — peça a um administrador.',
      );
    }

    return this.tasksService.create(
      context.organizationId,
      {
        title: input.title,
        description: input.description,
        customerId: input.customerId,
        assigneeId: input.assigneeId,
        ...(input.dueDate ? { dueDate: new Date(input.dueDate) } : {}),
      },
      { type: 'AI', id: context.userId },
    );
  }
}
