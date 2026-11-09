import { ListLeadSignalsTool } from './list-lead-signals.tool';

describe('ListLeadSignalsTool', () => {
  it('lista os sinais do lead sem exigir nenhum papel específico (leitura pura)', async () => {
    const signals = [{ id: 'sig-1', signalCode: 'website.no_ssl' }];
    const leadSignalsService = { listForLead: jest.fn().mockResolvedValue(signals) };
    const tool = new ListLeadSignalsTool(leadSignalsService as never);

    const result = await tool.execute(
      { leadId: 'lead-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
    );

    expect(result).toBe(signals);
    expect(leadSignalsService.listForLead).toHaveBeenCalledWith('org-1', 'lead-1');
  });
});
