import { BadRequestException } from '@nestjs/common';
import { SimplesService } from './simples.service';
import type { CompanyProfileService } from './company-profile.service';
import type { RevenueService } from './revenue.service';

function setup(rbt12Cents: number) {
  const revenue = {
    rbt12: jest.fn().mockResolvedValue({ month: '2026-11', rbt12Cents, method: 'TWELVE_MONTHS', monthsConsidered: [], basis: 'COMPETENCIA', activityStartMonth: null }),
  };
  const company = { snapshotAt: jest.fn().mockResolvedValue({ date: '2026-11-19', registration: null, regime: null, activities: [] }) };
  const service = new SimplesService(revenue as unknown as RevenueService, company as unknown as CompanyProfileService);
  return { service, revenue };
}

describe('SimplesService', () => {
  it('cenário livre usa INSS de 11% e folha zero por padrão', () => {
    const { service } = setup(0);
    const result = service.simulate({ faturamentoMensalCents: 2_000_000 });
    expect(result.economiaMensalCents).toBe(114_900);
  });

  it('cenário real usa o RBT12 da organização e a média mensal', async () => {
    const { service, revenue } = setup(24_000_000);
    const result = await service.simulateReal('org-1', {});
    expect(revenue.rbt12).toHaveBeenCalledWith('org-1', {});
    expect(result.simulation).toEqual(expect.objectContaining({ rbt12Cents: 24_000_000, faturamentoMensalCents: 2_000_000 }));
  });

  it('sem receita nos 12 meses, não simula', async () => {
    const { service } = setup(0);
    expect((await service.simulateReal('org-1', {})).simulation).toBeNull();
  });

  it('RBT12 fora do Simples vira 400', async () => {
    const { service } = setup(480_000_001);
    await expect(service.simulateReal('org-1', {})).rejects.toBeInstanceOf(BadRequestException);
  });
});
