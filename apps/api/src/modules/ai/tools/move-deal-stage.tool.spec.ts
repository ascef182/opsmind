import { ForbiddenException } from '@nestjs/common';
import { MoveDealStageTool } from './move-deal-stage.tool';

describe('MoveDealStageTool', () => {
  it('move o estágio do deal usando o organizationId do contexto', async () => {
    const deal = { id: 'deal-1', stage: 'PROPOSAL' };
    const dealsService = { moveStage: jest.fn().mockResolvedValue(deal) };
    const tool = new MoveDealStageTool(dealsService as never);

    const result = await tool.execute(
      { dealId: 'deal-1', stage: 'PROPOSAL' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toBe(deal);
    expect(dealsService.moveStage).toHaveBeenCalledWith(
      'org-1',
      'deal-1',
      { stage: 'PROPOSAL', lostReason: undefined },
      'user-1',
    );
  });

  it('recusa mover estágio quando o papel do usuário que invocou é VIEWER', async () => {
    const dealsService = { moveStage: jest.fn() };
    const tool = new MoveDealStageTool(dealsService as never);

    await expect(
      tool.execute(
        { dealId: 'deal-1', stage: 'PROPOSAL' },
        { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(dealsService.moveStage).not.toHaveBeenCalled();
  });
});
