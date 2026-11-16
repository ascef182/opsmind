jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ disconnect: jest.fn() })));

import { ForbiddenException } from '@nestjs/common';
import { Worker } from 'bullmq';
import { OutreachAutodraftConsumer } from './outreach-autodraft.consumer';

describe('OutreachAutodraftConsumer', () => {
  function buildConfigService() {
    return { get: jest.fn().mockReturnValue('redis://localhost:6379') };
  }

  function buildOutreachService() {
    return {
      generateDraft: jest.fn(),
      // As quatro transições humanas — nunca podem ser chamadas por este
      // consumer (ver regra dura no topo do arquivo). Mockadas aqui só para
      // que os testes abaixo possam afirmar, via spy, que nenhuma delas é
      // invocada em nenhum caminho (sucesso, orçamento estourado, ou erro).
      approve: jest.fn(),
      reject: jest.fn(),
      regenerate: jest.fn(),
      markSent: jest.fn(),
      markReplied: jest.fn(),
    };
  }

  const jobData = {
    organizationId: 'org-1',
    leadId: 'lead-1',
    channel: 'WHATSAPP' as const,
    serviceOfferingId: 'offering-1',
  };

  // Default: lead QUALIFIED no banco, mesmo organizationId/leadId do
  // `jobData` acima — representa o caso comum (transação que enfileirou o
  // job commitou normalmente). O teste de guarda contra rollback (Fix 2 do
  // review final) sobrescreve isso para simular o caso em que a transação
  // nunca commitou.
  function buildPrisma(leadOverrides: Partial<{ status: string }> = {}) {
    return {
      lead: {
        findUnique: jest.fn().mockResolvedValue({
          id: jobData.leadId,
          organizationId: jobData.organizationId,
          status: 'QUALIFIED',
          ...leadOverrides,
        }),
      },
    };
  }

  function getRegisteredProcessor(): (job: { data: typeof jobData }) => Promise<void> {
    const call = (Worker as unknown as jest.Mock).mock.calls[0] as [string, (job: unknown) => Promise<void>];
    return call[1] as (job: { data: typeof jobData }) => Promise<void>;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registra o Worker na fila "outreach-autodraft" no onModuleInit', () => {
    const consumer = new OutreachAutodraftConsumer(
      buildConfigService() as never,
      buildOutreachService() as never,
      buildPrisma() as never,
    );

    consumer.onModuleInit();

    expect(Worker).toHaveBeenCalledWith('outreach-autodraft', expect.any(Function), expect.anything());
  });

  it('chama generateDraft com actor SYSTEM e nunca approve/reject/markSent/markReplied/regenerate', async () => {
    const outreachService = buildOutreachService();
    outreachService.generateDraft.mockResolvedValue({ id: 'msg-1', status: 'DRAFT' });
    const consumer = new OutreachAutodraftConsumer(
      buildConfigService() as never,
      outreachService as never,
      buildPrisma() as never,
    );
    consumer.onModuleInit();

    const processor = getRegisteredProcessor();
    await processor({ data: jobData });

    expect(outreachService.generateDraft).toHaveBeenCalledWith(
      'org-1',
      'lead-1',
      { channel: 'WHATSAPP', serviceOfferingId: 'offering-1' },
      { type: 'SYSTEM' },
    );
    expect(outreachService.approve).not.toHaveBeenCalled();
    expect(outreachService.reject).not.toHaveBeenCalled();
    expect(outreachService.regenerate).not.toHaveBeenCalled();
    expect(outreachService.markSent).not.toHaveBeenCalled();
    expect(outreachService.markReplied).not.toHaveBeenCalled();
  });

  // Fix 2 do review final (Harvey Fase 7): o job é enfileirado DENTRO da
  // transação de request de `score()` — se essa transação nunca commitar
  // (ex.: `score_lead` chamado no meio de um chat multi-tool-call que depois
  // lança ou atinge MAX_ITERATIONS), o lead nunca ficou QUALIFIED de
  // verdade no banco, mas o job já está no Redis. Simula exatamente esse
  // cenário: o lead que o banco realmente tem ainda está em DISCOVERED.
  it('lead não está QUALIFIED no banco (rollback da transação que enfileirou): pula sem chamar generateDraft', async () => {
    const outreachService = buildOutreachService();
    const prisma = buildPrisma({ status: 'DISCOVERED' });
    const consumer = new OutreachAutodraftConsumer(
      buildConfigService() as never,
      outreachService as never,
      prisma as never,
    );
    consumer.onModuleInit();

    const processor = getRegisteredProcessor();

    await expect(processor({ data: jobData })).resolves.toBeUndefined();
    expect(prisma.lead.findUnique).toHaveBeenCalledWith({
      where: { id: jobData.leadId, organizationId: jobData.organizationId },
    });
    expect(outreachService.generateDraft).not.toHaveBeenCalled();
    expect(outreachService.approve).not.toHaveBeenCalled();
    expect(outreachService.markSent).not.toHaveBeenCalled();
  });

  it('ForbiddenException (orçamento de IA estourado) resolve o job sem relançar', async () => {
    const outreachService = buildOutreachService();
    outreachService.generateDraft.mockRejectedValue(new ForbiddenException('Orçamento mensal de IA atingido.'));
    const consumer = new OutreachAutodraftConsumer(
      buildConfigService() as never,
      outreachService as never,
      buildPrisma() as never,
    );
    consumer.onModuleInit();

    const processor = getRegisteredProcessor();

    await expect(processor({ data: jobData })).resolves.toBeUndefined();
    expect(outreachService.approve).not.toHaveBeenCalled();
    expect(outreachService.markSent).not.toHaveBeenCalled();
  });

  it('qualquer outro erro relança (deixa o retry padrão do BullMQ agir)', async () => {
    const outreachService = buildOutreachService();
    const networkError = new Error('Falha de rede ao chamar o gateway de IA');
    outreachService.generateDraft.mockRejectedValue(networkError);
    const consumer = new OutreachAutodraftConsumer(
      buildConfigService() as never,
      outreachService as never,
      buildPrisma() as never,
    );
    consumer.onModuleInit();

    const processor = getRegisteredProcessor();

    await expect(processor({ data: jobData })).rejects.toThrow('Falha de rede ao chamar o gateway de IA');
  });

  it('onModuleDestroy fecha o Worker e desconecta o Redis', async () => {
    const consumer = new OutreachAutodraftConsumer(
      buildConfigService() as never,
      buildOutreachService() as never,
      buildPrisma() as never,
    );
    consumer.onModuleInit();
    const workerInstance = (Worker as unknown as jest.Mock).mock.results[0]!.value as {
      close: jest.Mock;
    };

    await consumer.onModuleDestroy();

    expect(workerInstance.close).toHaveBeenCalled();
  });
});
