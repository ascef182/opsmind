import { ForbiddenException } from '@nestjs/common';
import { CreateTaskTool } from './create-task.tool';

describe('CreateTaskTool', () => {
  it('cria a tarefa com actorType AI e actorId igual ao userId de quem invocou a IA', async () => {
    const task = { id: 'task-1', title: 'Follow-up' };
    const tasksService = { create: jest.fn().mockResolvedValue(task) };
    const tool = new CreateTaskTool(tasksService as never);

    const result = await tool.execute(
      { title: 'Follow-up', customerId: 'cust-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toBe(task);
    expect(tasksService.create).toHaveBeenCalledWith(
      'org-1',
      { title: 'Follow-up', customerId: 'cust-1' },
      { type: 'AI', id: 'user-1' },
    );
  });

  it('recusa criar tarefa quando o papel do usuário que invocou é VIEWER', async () => {
    const tasksService = { create: jest.fn() };
    const tool = new CreateTaskTool(tasksService as never);

    await expect(
      tool.execute(
        { title: 'Follow-up' },
        { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('converte dueDate de string ISO para Date antes de repassar ao service', async () => {
    const tasksService = { create: jest.fn().mockResolvedValue({ id: 'task-1' }) };
    const tool = new CreateTaskTool(tasksService as never);

    await tool.execute(
      { title: 'Follow-up', dueDate: '2026-09-01T00:00:00.000Z' },
      { organizationId: 'org-1', userId: 'user-1', role: 'OWNER' },
    );

    const [, dto] = tasksService.create.mock.calls[0];
    expect(dto.dueDate).toBeInstanceOf(Date);
    expect((dto.dueDate as Date).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});
