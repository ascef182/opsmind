import { withTenantContext } from './tenant-context';

describe('withTenantContext', () => {
  it('define app.current_org_id na transação antes de rodar a função, e devolve o resultado dela', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(undefined) };
    const prisma = { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tx)) };
    const fn = jest.fn().mockResolvedValue('resultado');

    const result = await withTenantContext(prisma as never, 'org-1', fn);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = tx.$executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain('current_org_id');
    expect(values).toContain('org-1');
    expect(fn).toHaveBeenCalledWith(tx);
    expect(result).toBe('resultado');
  });
});
