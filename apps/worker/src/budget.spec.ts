import { getMonthSpend, isOverBudget, recordSpend } from './budget';

describe('budget (scraping)', () => {
  function fakeRedis() {
    return {
      get: jest.fn(),
      incrbyfloat: jest.fn(),
      expire: jest.fn(),
    };
  }

  it('getMonthSpend lê a chave scraping-budget:<org>:<ano-mês> e devolve 0 quando não existe', async () => {
    const redis = fakeRedis();
    redis.get.mockResolvedValue(null);

    const spend = await getMonthSpend(redis as never, 'org-1');

    expect(spend).toBe(0);
    expect(redis.get).toHaveBeenCalledWith(expect.stringMatching(/^scraping-budget:org-1:\d{4}-\d{2}$/));
  });

  it('isOverBudget nunca corta quando monthlyBudget é null (organização sem orçamento configurado)', async () => {
    const redis = fakeRedis();
    redis.get.mockResolvedValue('999999');

    const over = await isOverBudget(redis as never, 'org-1', null);

    expect(over).toBe(false);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('isOverBudget corta quando o gasto do mês já é >= o orçamento', async () => {
    const redis = fakeRedis();
    redis.get.mockResolvedValue('50');

    expect(await isOverBudget(redis as never, 'org-1', 50)).toBe(true);
    expect(await isOverBudget(redis as never, 'org-1', 51)).toBe(false);
  });

  it('recordSpend usa incrbyfloat e define TTL só com NX (não adia expiração já setada)', async () => {
    const redis = fakeRedis();

    await recordSpend(redis as never, 'org-1', 0.05);

    expect(redis.incrbyfloat).toHaveBeenCalledWith(
      expect.stringMatching(/^scraping-budget:org-1:\d{4}-\d{2}$/),
      0.05,
    );
    expect(redis.expire).toHaveBeenCalledWith(expect.any(String), 35 * 24 * 60 * 60, 'NX');
  });
});
