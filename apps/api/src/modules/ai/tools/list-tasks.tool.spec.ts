import { ListTasksTool } from './list-tasks.tool';

describe('ListTasksTool', () => {
  it('lista tarefas filtrando sempre pelo organizationId do contexto', async () => {
    const tasks = [{ id: 'task-1', title: 'Follow-up' }];
    const tasksService = { list: jest.fn().mockResolvedValue(tasks) };
    const tool = new ListTasksTool(tasksService as never);

    const result = await tool.execute(
      { status: 'OPEN', assigneeId: 'user-2' },
      { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
    );

    expect(result).toBe(tasks);
    expect(tasksService.list).toHaveBeenCalledWith('org-1', {
      status: 'OPEN',
      assigneeId: 'user-2',
      customerId: undefined,
    });
  });
});
