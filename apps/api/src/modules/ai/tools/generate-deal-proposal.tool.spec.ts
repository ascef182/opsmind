import { ForbiddenException } from '@nestjs/common';
import { GenerateDealProposalTool } from './generate-deal-proposal.tool';

describe('GenerateDealProposalTool', () => {
  it('gera a proposta usando o organizationId/userId do contexto', async () => {
    const deal = { id: 'deal-1', proposalDraft: 'Minuta...' };
    const dealProposalService = { generate: jest.fn().mockResolvedValue(deal) };
    const tool = new GenerateDealProposalTool(dealProposalService as never);

    const result = await tool.execute(
      { dealId: 'deal-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toBe(deal);
    expect(dealProposalService.generate).toHaveBeenCalledWith('org-1', 'deal-1', 'user-1');
  });

  it('recusa gerar proposta quando o papel do usuário que invocou é VIEWER', async () => {
    const dealProposalService = { generate: jest.fn() };
    const tool = new GenerateDealProposalTool(dealProposalService as never);

    await expect(
      tool.execute({ dealId: 'deal-1' }, { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' }),
    ).rejects.toThrow(ForbiddenException);
    expect(dealProposalService.generate).not.toHaveBeenCalled();
  });
});
