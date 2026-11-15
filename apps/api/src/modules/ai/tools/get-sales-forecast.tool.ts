import { Injectable } from '@nestjs/common';
import { DashboardService, type SalesForecast } from '../../dashboard/dashboard.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

// Leitura pura, sem gate de WRITE_ROLES — mesmo padrão de `list-deals.tool.ts`.
// Sem nenhum input: o forecast é sempre "da organização inteira, agora", não
// há filtro que faça sentido o modelo escolher aqui.
@Injectable()
export class GetSalesForecastTool implements AiTool<Record<string, never>> {
  readonly name = 'get_sales_forecast';
  readonly description =
    'Retorna a previsão de fechamento de negócios da organização: pipeline ponderado pela ' +
    'probabilidade de cada estágio, valor sem data de fechamento prevista, breakdown por mês, e a ' +
    'tendência de receita fechada (deals ganhos) dos últimos 6 meses.';
  readonly inputSchema = { type: 'object', properties: {}, required: [], additionalProperties: false };

  constructor(private readonly dashboardService: DashboardService) {}

  execute(_input: Record<string, never>, context: AiToolContext): Promise<SalesForecast> {
    return this.dashboardService.getSalesForecast(context.organizationId);
  }
}
