import { GetSalesForecastTool } from './get-sales-forecast.tool';

describe('GetSalesForecastTool', () => {
  it('busca o forecast usando o organizationId do contexto, não de um input do modelo', async () => {
    const forecast = { weightedPipelineValue: 1300, unscheduledValue: 0, forecastByMonth: [], wonRevenueByMonth: [] };
    const dashboardService = { getSalesForecast: jest.fn().mockResolvedValue(forecast) };
    const tool = new GetSalesForecastTool(dashboardService as never);

    const result = await tool.execute({}, { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' });

    expect(result).toBe(forecast);
    expect(dashboardService.getSalesForecast).toHaveBeenCalledWith('org-1');
  });

  it('não exige WRITE_ROLES — é leitura pura, disponível até para VIEWER', async () => {
    const dashboardService = {
      getSalesForecast: jest
        .fn()
        .mockResolvedValue({ weightedPipelineValue: 0, unscheduledValue: 0, forecastByMonth: [], wonRevenueByMonth: [] }),
    };
    const tool = new GetSalesForecastTool(dashboardService as never);

    await expect(
      tool.execute({}, { organizationId: 'org-1', userId: 'user-1', role: 'VIEWER' }),
    ).resolves.toEqual({ weightedPipelineValue: 0, unscheduledValue: 0, forecastByMonth: [], wonRevenueByMonth: [] });
  });

  it('não declara nenhum input controlável pelo modelo', () => {
    const tool = new GetSalesForecastTool({} as never);

    expect(tool.inputSchema).toEqual({ type: 'object', properties: {}, required: [], additionalProperties: false });
  });
});
