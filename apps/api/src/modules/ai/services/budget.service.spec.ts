import { Test } from '@nestjs/testing';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { BudgetService } from './budget.service';

describe('BudgetService', () => {
  let service: BudgetService;
  let redis: { get: jest.Mock; incrbyfloat: jest.Mock; expire: jest.Mock };

  beforeEach(async () => {
    redis = { get: jest.fn(), incrbyfloat: jest.fn(), expire: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [BudgetService, { provide: RedisService, useValue: redis }],
    }).compile();

    service = module.get(BudgetService);
  });

  describe('getMonthSpend', () => {
    it('retorna 0 quando não há gasto registrado ainda no mês', async () => {
      redis.get.mockResolvedValue(null);

      const spend = await service.getMonthSpend('org-1');

      expect(spend).toBe(0);
      const [key] = redis.get.mock.calls[0];
      expect(key).toMatch(/^ai-budget:org-1:\d{4}-\d{2}$/);
    });

    it('retorna o valor acumulado convertido para número', async () => {
      redis.get.mockResolvedValue('12.5');

      const spend = await service.getMonthSpend('org-1');

      expect(spend).toBe(12.5);
    });
  });

  describe('isOverBudget', () => {
    it('nunca corta quando a organização não tem orçamento configurado (null)', async () => {
      const result = await service.isOverBudget('org-1', null);

      expect(result).toBe(false);
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('retorna false quando o gasto do mês está abaixo do orçamento', async () => {
      redis.get.mockResolvedValue('50');

      const result = await service.isOverBudget('org-1', 100);

      expect(result).toBe(false);
    });

    it('retorna true quando o gasto do mês já atingiu ou passou o orçamento', async () => {
      redis.get.mockResolvedValue('100');

      const result = await service.isOverBudget('org-1', 100);

      expect(result).toBe(true);
    });
  });

  describe('recordSpend', () => {
    it('incrementa o contador do mês e define expiração só se ainda não existir', async () => {
      await service.recordSpend('org-1', 0.42);

      const [key, amount] = redis.incrbyfloat.mock.calls[0];
      expect(key).toMatch(/^ai-budget:org-1:\d{4}-\d{2}$/);
      expect(amount).toBe(0.42);
      expect(redis.expire).toHaveBeenCalledWith(key, expect.any(Number), 'NX');
    });
  });
});
