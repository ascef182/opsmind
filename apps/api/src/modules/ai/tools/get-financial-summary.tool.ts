import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { isValidMonthKey } from '@opsmind/shared-types';
import { ROLE_HIERARCHY } from '../../../shared/constants/roles.constant';
import { FINANCE_READ_ROLE } from '../../finance/finance.constants';
import { FinanceReportsService, type FinanceOverview } from '../../finance/finance-reports.service';
import type { AiTool, AiToolContext } from './ai-tool.interface';

interface Input {
  month?: string;
}

// Leitura pura, mas com gate de papel: faturamento/dívida/lucro só para quem
// pode ver a tela Financeiro (MANAGER+). Sem esse gate a IA viraria um atalho
// para um MEMBER ler o que a API HTTP já lhe nega.
@Injectable()
export class GetFinancialSummaryTool implements AiTool<Input> {
  readonly name = 'get_financial_summary';
  readonly description =
    'Resumo financeiro da organização para um mês (padrão: mês atual): receita contratada, faturada e ' +
    'recebida, despesas pagas, resultado realizado, saldo a receber e vencido, a pagar, MRR (receita ' +
    'recorrente mensal), contratos ativos, próximos vencimentos e negócios ganhos sem contrato. ' +
    'Valores em centavos (BRL). Só disponível para gerentes e acima.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'Mês no formato AAAA-MM. Omitir para o mês atual.' },
    },
    required: [],
    additionalProperties: false,
  };

  constructor(private readonly reports: FinanceReportsService) {}

  async execute(input: Input, context: AiToolContext): Promise<FinanceOverview> {
    const level = ROLE_HIERARCHY.indexOf(context.role as never);
    if (level < 0 || level > ROLE_HIERARCHY.indexOf(FINANCE_READ_ROLE as never)) {
      throw new ForbiddenException(
        'Seu papel nesta organização não permite consultar dados financeiros — peça a um gerente ou administrador.',
      );
    }
    if (input.month !== undefined && !isValidMonthKey(input.month)) {
      throw new BadRequestException('month deve estar no formato AAAA-MM');
    }
    return this.reports.overview(context.organizationId, { month: input.month });
  }
}
