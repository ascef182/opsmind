// Opções padrão de job por fila, aplicadas no construtor da `Queue` (vale
// para todo `add()`, de qualquer produtor: API e worker). Sem isto o BullMQ
// roda cada job uma vez só (`attempts: 1`) e acumula todo job concluído no
// Redis para sempre. Objetos simples para não puxar `bullmq` para este pacote.

const RETENTION = {
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

// Jobs idempotentes ou baratos de repetir (investigação de site, scan e
// clustering de Reddit).
export const RETRYABLE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  ...RETENTION,
};

// Autodraft: a janela longa (2s, 4s, 8s, 16s, 32s) existe para o guard de
// rollback do consumer esperar o commit da transação que enfileirou o job
// (ver `OutreachAutodraftQueueService.enqueue`). Na fila, e não só no `add()`
// da API, para valer também quando é o worker quem enfileira.
export const AUTODRAFT_JOB_OPTIONS = {
  attempts: 6,
  backoff: { type: 'exponential' as const, delay: 2000 },
  ...RETENTION,
};

// Busca de leads: retry pagaria o provedor de novo pela mesma busca.
export const NON_RETRYABLE_JOB_OPTIONS = {
  attempts: 1,
  ...RETENTION,
};
