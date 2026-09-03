import { ScoreLeadTool } from './score-lead.tool';

describe('ScoreLeadTool', () => {
  it('recalcula o score do lead e retorna o scoreBreakdown', async () => {
    const scoreBreakdown = { total: 72, matchedOfferingId: 'offering-1', matchedSignals: ['sem site'] };
    const leadsService = {
      score: jest.fn().mockResolvedValue({ id: 'lead-1', score: 72, scoreBreakdown }),
    };
    const tool = new ScoreLeadTool(leadsService as never);

    const result = await tool.execute(
      { leadId: 'lead-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toBe(scoreBreakdown);
    expect(leadsService.score).toHaveBeenCalledWith('org-1', 'lead-1', 'user-1');
  });

  it('não recusa a chamada para o papel VIEWER (cálculo determinístico, sem gate de role)', async () => {
    const scoreBreakdown = { total: 40, matchedOfferingId: null, matchedSignals: [] };
    const leadsService = {
      score: jest.fn().mockResolvedValue({ id: 'lead-1', score: 40, scoreBreakdown }),
    };
    const tool = new ScoreLeadTool(leadsService as never);

    await expect(
      tool.execute({ leadId: 'lead-1' }, { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' }),
    ).resolves.toBe(scoreBreakdown);
    expect(leadsService.score).toHaveBeenCalledWith('org-1', 'lead-1', 'user-1');
  });
});
