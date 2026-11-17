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

  type FakeJob = {
    data: typeof jobData;
    attemptsMade?: number;
    opts?: { attempts?: number };
  };

  function getRegisteredProcessor(): (job: FakeJob) => Promise<void> {
    const call = (Worker as unknown as jest.Mock).mock.calls[0] as [string, (job: unknown) => Promise<void>];
    return call[1] as (job: FakeJob) => Promise<void>;
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

  // Fix 2 do review final (Harvey Fase 7) + correção de uma regressão Critical
  // encontrada num re-review posterior: o job é enfileirado DENTRO da
  // transação de request de `score()`, e o Worker deste processo normalmente
  // pega o job poucos milissegundos depois — quase sempre ANTES dessa
  // transação commitar. A primeira versão deste guard pulava permanentemente
  // na primeira leitura não-QUALIFIED, o que matava o gatilho quase sempre
  // pro caminho da AI tool `score_lead` (transação fica aberta por várias
  // iterações de chat) e virava cara-ou-coroa pro REST/`enrich()`. Uma
  // transação ainda não commitada e um rollback de verdade são
  // indistinguíveis numa leitura só — por isso agora relança (deixando o
  // BullMQ reagendar com backoff, ver `attempts`/`backoff` em
  // `OutreachAutodraftQueueService.enqueue()`) enquanto não for a última
  // tentativa permitida, e só desiste de vez nela.
  it('lead não está QUALIFIED no banco e NÃO é a última tentativa: relança pra deixar o BullMQ reagendar', async () => {
    const outreachService = buildOutreachService();
    const prisma = buildPrisma({ status: 'DISCOVERED' });
    const consumer = new OutreachAutodraftConsumer(
      buildConfigService() as never,
      outreachService as never,
      prisma as never,
    );
    consumer.onModuleInit();

    const processor = getRegisteredProcessor();
    // `attemptsMade: 0` + `opts.attempts: 6` ⇒ esta é a 1ª de 6 tentativas
    // permitidas — ainda não é a última.
    const job: FakeJob = { data: jobData, attemptsMade: 0, opts: { attempts: 6 } };

    await expect(processor(job)).rejects.toThrow(/tentativa 1 de 6/);
    expect(prisma.lead.findUnique).toHaveBeenCalledWith({
      where: { id: jobData.leadId, organizationId: jobData.organizationId },
    });
    expect(outreachService.generateDraft).not.toHaveBeenCalled();
  });

  it('lead não está QUALIFIED no banco na ÚLTIMA tentativa permitida: desiste de vez, sem relançar nem chamar generateDraft', async () => {
    const outreachService = buildOutreachService();
    const prisma = buildPrisma({ status: 'DISCOVERED' });
    const consumer = new OutreachAutodraftConsumer(
      buildConfigService() as never,
      outreachService as never,
      prisma as never,
    );
    consumer.onModuleInit();

    const processor = getRegisteredProcessor();
    // `attemptsMade: 5` + `opts.attempts: 6` ⇒ esta é a 6ª de 6 tentativas
    // permitidas — é a última; `attemptsMade` reflete as tentativas JÁ
    // concluídas antes desta (ver comentário em `process()`).
    const job: FakeJob = { data: jobData, attemptsMade: 5, opts: { attempts: 6 } };

    await expect(processor(job)).resolves.toBeUndefined();
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
