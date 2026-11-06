import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GetFinancialSummaryTool } from './get-financial-summary.tool';
import type { FinanceReportsService } from '../../finance/finance-reports.service';

describe('GetFinancialSummaryTool', () => {
  const overview = jest.fn().mockResolvedValue({ ok: true });
  const tool = new GetFinancialSummaryTool({ overview } as unknown as FinanceReportsService);
  const ctx = (role: string) => ({ organizationId: 'org-1', userId: 'u1', role }) as never;

  beforeEach(() => overview.mockClear());

  it.each(['OWNER', 'ADMIN', 'MANAGER'])('%s pode consultar, sempre com a org do contexto', async (role) => {
    await tool.execute({ month: '2026-10' }, ctx(role));
    expect(overview).toHaveBeenCalledWith('org-1', { month: '2026-10' });
  });

  it.each(['MEMBER', 'VIEWER', 'DESCONHECIDO'])('%s é bloqueado sem tocar no banco', async (role) => {
    await expect(tool.execute({}, ctx(role))).rejects.toBeInstanceOf(ForbiddenException);
    expect(overview).not.toHaveBeenCalled();
  });

  it('rejeita mês inválido vindo do modelo', async () => {
    await expect(tool.execute({ month: '2026-13' }, ctx('OWNER'))).rejects.toBeInstanceOf(BadRequestException);
    expect(overview).not.toHaveBeenCalled();
  });

  it('o schema não expõe organizationId ao modelo', () => {
    expect(Object.keys(tool.inputSchema.properties)).toEqual(['month']);
  });
});
