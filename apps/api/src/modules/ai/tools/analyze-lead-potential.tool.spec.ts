import { ForbiddenException } from '@nestjs/common';
import { AnalyzeLeadPotentialTool } from './analyze-lead-potential.tool';

describe('AnalyzeLeadPotentialTool', () => {
  it('chama LeadAnalysisService.analyzeLeadPotential e retorna o LeadEnrichment gerado', async () => {
    const enrichment = { id: 'enrich-1', type: 'ai_analysis', data: { text: 'Bom alvo...' } };
    const leadAnalysisService = { analyzeLeadPotential: jest.fn().mockResolvedValue(enrichment) };
    const tool = new AnalyzeLeadPotentialTool(leadAnalysisService as never);

    const result = await tool.execute(
      { leadId: 'lead-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toBe(enrichment);
    expect(leadAnalysisService.analyzeLeadPotential).toHaveBeenCalledWith('org-1', 'lead-1', 'user-1');
  });

  it('recusa gerar análise de IA quando o papel do usuário é VIEWER', async () => {
    const leadAnalysisService = { analyzeLeadPotential: jest.fn() };
    const tool = new AnalyzeLeadPotentialTool(leadAnalysisService as never);

    await expect(
      tool.execute({ leadId: 'lead-1' }, { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' }),
    ).rejects.toThrow(ForbiddenException);
    expect(leadAnalysisService.analyzeLeadPotential).not.toHaveBeenCalled();
  });
});
