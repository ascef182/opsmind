import { ForbiddenException } from '@nestjs/common';
import { AiService } from './ai.service';
import type { AiGateway } from './gateway/ai-gateway.interface';
import type { AiTool } from './tools/ai-tool.interface';

function buildDeps() {
  const gateway: jest.Mocked<AiGateway> = { sendMessage: jest.fn() };

  const searchCustomersTool: jest.Mocked<AiTool> = {
    name: 'search_customers',
    description: 'busca clientes',
    inputSchema: { type: 'object' },
    execute: jest.fn(),
  };

  const tools = [searchCustomersTool];

  const budgetService = {
    isOverBudget: jest.fn().mockResolvedValue(false),
    recordSpend: jest.fn().mockResolvedValue(undefined),
  };

  const organizationsService = {
    findById: jest.fn().mockResolvedValue({ id: 'org-1', aiMonthlyBudget: null }),
  };

  const auditService = { log: jest.fn().mockResolvedValue(undefined) };

  const txMock = {
    aIRequest: { create: jest.fn().mockResolvedValue({ id: 'ai-req-1' }) },
    aIRequestToolCall: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    runInTransaction: jest.fn((fn: (tx: typeof txMock) => unknown) => fn(txMock)),
  };

  const actor = { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' as const };

  const service = new AiService(
    gateway,
    tools,
    budgetService as never,
    organizationsService as never,
    auditService as never,
    prisma as never,
  );

  return { service, gateway, searchCustomersTool, budgetService, organizationsService, auditService, txMock, actor };
}

describe('AiService', () => {
  it('corta a conversa antes de chamar o gateway quando a organização já estourou o orçamento do mês', async () => {
    const { service, gateway, budgetService, txMock, actor } = buildDeps();
    budgetService.isOverBudget.mockResolvedValue(true);

    await expect(service.chat(actor, { message: 'oi' })).rejects.toThrow(ForbiddenException);

    expect(gateway.sendMessage).not.toHaveBeenCalled();
    expect(txMock.aIRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'BUDGET_EXCEEDED' }) }),
    );
  });

  it('responde direto quando o modelo não pede nenhuma tool, registra o AIRequest e credita o gasto', async () => {
    const { service, gateway, budgetService, txMock, actor } = buildDeps();
    gateway.sendMessage.mockResolvedValueOnce({
      id: 'msg_1',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Olá! Como posso ajudar?' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    } as never);

    const result = await service.chat(actor, { message: 'oi' });

    expect(result).toEqual({ reply: 'Olá! Como posso ajudar?', aiRequestId: 'ai-req-1' });
    expect(txMock.aIRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-1',
          status: 'SUCCESS',
          inputTokens: 100,
          outputTokens: 50,
        }),
      }),
    );
    expect(budgetService.recordSpend).toHaveBeenCalledWith('org-1', expect.any(Number));
  });

  it('executa a tool pedida pelo modelo, injeta o contexto real (nunca o do input) e audita a chamada', async () => {
    const { service, gateway, searchCustomersTool, auditService, txMock, actor } = buildDeps();
    searchCustomersTool.execute.mockResolvedValue([{ id: 'cust-1', name: 'Acme' }]);
    gateway.sendMessage
      .mockResolvedValueOnce({
        id: 'msg_1',
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tool_1', name: 'search_customers', input: { query: 'acme' } },
        ],
        usage: { input_tokens: 60, output_tokens: 20 },
      } as never)
      .mockResolvedValueOnce({
        id: 'msg_2',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Encontrei a Acme.' }],
        usage: { input_tokens: 30, output_tokens: 15 },
      } as never);

    const result = await service.chat(actor, { message: 'ache a acme' });

    expect(result.reply).toBe('Encontrei a Acme.');
    expect(searchCustomersTool.execute).toHaveBeenCalledWith(
      { query: 'acme' },
      { organizationId: 'org-1', userId: 'user-1', role: 'MEMBER' },
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'AI',
        actorId: 'user-1',
        organizationId: 'org-1',
        action: 'ai.tool.search_customers',
      }),
    );
    expect(txMock.aIRequestToolCall.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            aiRequestId: 'ai-req-1',
            toolName: 'search_customers',
            isError: false,
          }),
        ],
      }),
    );
    // Soma dos tokens das duas rodadas do loop, não só da última.
    expect(txMock.aIRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ inputTokens: 90, outputTokens: 35 }) }),
    );
  });

  it('quando a tool falha (ex.: papel insuficiente), devolve o erro pro modelo como tool_result e ainda audita a tentativa', async () => {
    const { service, gateway, searchCustomersTool, auditService, actor } = buildDeps();
    searchCustomersTool.execute.mockRejectedValue(new Error('Papel insuficiente'));
    gateway.sendMessage
      .mockResolvedValueOnce({
        id: 'msg_1',
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'search_customers', input: {} }],
        usage: { input_tokens: 10, output_tokens: 5 },
      } as never)
      .mockResolvedValueOnce({
        id: 'msg_2',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Não consegui buscar: papel insuficiente.' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      } as never);

    const result = await service.chat(actor, { message: 'ache clientes' });

    expect(result.reply).toContain('Não consegui buscar');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.tool.search_customers' }),
    );
    // `messages` é o mesmo array mutado a cada iteração do loop — lido pela
    // referência guardada em mock.calls, então por índice fixo (a mensagem de
    // tool_result sempre cai na posição 2: user, assistant/tool_use, tool_result),
    // nunca por `.at(-1)`, que pegaria pushes futuros feitos depois desta chamada.
    const secondCallArgs = gateway.sendMessage.mock.calls[1]!;
    const toolResultMessage = secondCallArgs[0].messages[2];
    expect(toolResultMessage).toEqual({
      role: 'user',
      content: [
        expect.objectContaining({ type: 'tool_result', tool_use_id: 'tool_1', is_error: true }),
      ],
    });
  });

  it('registra AIRequest com status ERROR e propaga o erro quando o gateway falha', async () => {
    const { service, gateway, txMock, actor } = buildDeps();
    gateway.sendMessage.mockRejectedValue(new Error('Anthropic API indisponível'));

    await expect(service.chat(actor, { message: 'oi' })).rejects.toThrow('Anthropic API indisponível');

    expect(txMock.aIRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ERROR', errorMessage: 'Anthropic API indisponível' }),
      }),
    );
  });

  it('desiste depois de um número máximo de idas e voltas de tool_use, para não rodar para sempre', async () => {
    const { service, gateway, searchCustomersTool, txMock, actor } = buildDeps();
    searchCustomersTool.execute.mockResolvedValue([]);
    gateway.sendMessage.mockResolvedValue({
      id: 'msg_loop',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tool_x', name: 'search_customers', input: {} }],
      usage: { input_tokens: 1, output_tokens: 1 },
    } as never);

    await expect(service.chat(actor, { message: 'loop' })).rejects.toThrow();

    expect(txMock.aIRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ERROR' }) }),
    );
  });
});
