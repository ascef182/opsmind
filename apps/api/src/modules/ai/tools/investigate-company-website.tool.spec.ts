import { ForbiddenException } from '@nestjs/common';
import { InvestigateCompanyWebsiteTool } from './investigate-company-website.tool';

describe('InvestigateCompanyWebsiteTool', () => {
  it('enfileira a investigação via LeadSignalsService e retorna status QUEUED sem esperar o job', async () => {
    const leadSignalsService = { requestInvestigation: jest.fn().mockResolvedValue(undefined) };
    const tool = new InvestigateCompanyWebsiteTool(leadSignalsService as never);

    const result = await tool.execute(
      { leadId: 'lead-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );

    expect(result).toEqual({ status: 'QUEUED' });
    expect(leadSignalsService.requestInvestigation).toHaveBeenCalledWith('org-1', 'lead-1', 'user-1');
  });

  it('recusa disparar investigação quando o papel do usuário que invocou é VIEWER', async () => {
    const leadSignalsService = { requestInvestigation: jest.fn() };
    const tool = new InvestigateCompanyWebsiteTool(leadSignalsService as never);

    await expect(
      tool.execute({ leadId: 'lead-1' }, { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' }),
    ).rejects.toThrow(ForbiddenException);
    expect(leadSignalsService.requestInvestigation).not.toHaveBeenCalled();
  });
});
