import type { AiGateway } from '../gateway/ai-gateway.interface';
import {
  AiBudgetExceededException,
  AiOneShotRunner,
  AiRefusalException,
  type AiOneShotInput,
} from './ai-one-shot-runner';

function buildDeps() {
  const tx = {
    aIRequest: { create: jest.fn().mockResolvedValue({ id: 'ai-req-1' }) },
    costEvent: { create: jest.fn() },
  };
  const prismaOutOfBand = {
    runOutsideTransaction: jest.fn((_organizationId: string, fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const gateway: jest.Mocked<AiGateway> = { sendMessage: jest.fn() };
  const budgetService = {
    isOverBudget: jest.fn().mockResolvedValue(false),
    recordSpend: jest.fn().mockResolvedValue(undefined),
  };
  const runner = new AiOneShotRunner(prismaOutOfBand as never, gateway, budgetService as never);
  return { runner, tx, prismaOutOfBand, gateway, budgetService };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    model: 'claude-sonnet-5-5',
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: ' Olá ' },
      { type: 'text', text: 'mundo' },
    ],
    usage: { input_tokens: 1_000_000, output_tokens: 100_000 },
    ...overrides,
  } as never;
}

const input: AiOneShotInput = {
  organizationId: 'org-1',
  monthlyBudget: 50,
  operation: 'outreach.draft',
  agent: 'outreach-copywriting',
  actor: { type: 'USER', userId: 'user-1' },
  system: 'sys',
  prompt: 'prompt',
  tier: 'standard',
  effort: 'low',
  leadId: 'lead-1',
};

describe('AiOneShotRunner', () => {
  it('chama o gateway com tier/effort, devolve só o texto e contabiliza custo, AIRequest e CostEvent', async () => {
    const { runner, tx, gateway, budgetService } = buildDeps();
    gateway.sendMessage.mockResolvedValue(response());

    const result = await runner.run(input);

    expect(gateway.sendMessage).toHaveBeenCalledWith({
      system: 'sys',
      messages: [{ role: 'user', content: 'prompt' }],
      tools: [],
      tier: 'standard',
      effort: 'low',
    });
    expect(result.text).toBe('Olá \nmundo');
    expect(result.model).toBe('claude-sonnet-5-5');
    // 1M entrada × $2 + 100K saída × $10
    expect(result.costUsd).toBeCloseTo(3);
    expect(tx.aIRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        actorType: 'USER',
        operation: 'outreach.draft',
        model: 'claude-sonnet-5-5',
        status: 'SUCCESS',
      }),
    });
    expect(tx.costEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: 'AI',
        provider: 'anthropic',
        operation: 'outreach.draft',
        agent: 'outreach-copywriting',
        leadId: 'lead-1',
        aiRequestId: 'ai-req-1',
      }),
    });
    expect(budgetService.recordSpend).toHaveBeenCalledWith('org-1', result.costUsd);
  });

  it('orçamento estourado: não chama o gateway, grava BUDGET_EXCEEDED sem custo e lança 403', async () => {
    const { runner, tx, gateway, budgetService } = buildDeps();
    budgetService.isOverBudget.mockResolvedValue(true);

    await expect(runner.run(input)).rejects.toThrow(AiBudgetExceededException);

    expect(gateway.sendMessage).not.toHaveBeenCalled();
    expect(tx.aIRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'BUDGET_EXCEEDED', estimatedCost: 0 }),
    });
    expect(tx.costEvent.create).not.toHaveBeenCalled();
    expect(budgetService.recordSpend).not.toHaveBeenCalled();
  });

  it('falha do gateway: grava ERROR com a mensagem e propaga o erro original', async () => {
    const { runner, tx, gateway, budgetService } = buildDeps();
    gateway.sendMessage.mockRejectedValue(new Error('timeout'));

    await expect(runner.run(input)).rejects.toThrow('timeout');

    expect(tx.aIRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'ERROR', errorMessage: 'timeout' }),
    });
    expect(budgetService.recordSpend).not.toHaveBeenCalled();
  });

  it('recusa do modelo: cobra o que foi gasto e lança em vez de devolver texto vazio', async () => {
    const { runner, tx, gateway, budgetService } = buildDeps();
    gateway.sendMessage.mockResolvedValue(response({ stop_reason: 'refusal', content: [] }));

    await expect(runner.run(input)).rejects.toThrow(AiRefusalException);

    expect(tx.aIRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'ERROR', errorMessage: 'refusal' }),
    });
    expect(budgetService.recordSpend).toHaveBeenCalledWith('org-1', expect.any(Number));
  });

  it('ator SYSTEM grava AIRequest sem usuário', async () => {
    const { runner, tx, gateway } = buildDeps();
    gateway.sendMessage.mockResolvedValue(response());

    await runner.run({ ...input, actor: { type: 'SYSTEM' } });

    expect(tx.aIRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null, actorType: 'SYSTEM', actorId: null }),
    });
  });
});
