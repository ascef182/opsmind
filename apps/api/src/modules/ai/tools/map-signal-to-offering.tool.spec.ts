import { MapSignalToOfferingTool } from './map-signal-to-offering.tool';

describe('MapSignalToOfferingTool', () => {
  it('devolve o agrupamento de sinais por oferta (com evidência), sem exigir papel específico', async () => {
    const mapping = [{ offeringId: 'off-1', matchedSignalCodes: ['website.no_ssl'], evidence: [] }];
    const leadSignalsService = { mapToOfferings: jest.fn().mockResolvedValue(mapping) };
    const tool = new MapSignalToOfferingTool(leadSignalsService as never);

    const result = await tool.execute(
      { leadId: 'lead-1' },
      { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' },
    );

    expect(result).toBe(mapping);
    expect(leadSignalsService.mapToOfferings).toHaveBeenCalledWith('org-1', 'lead-1');
  });
});
