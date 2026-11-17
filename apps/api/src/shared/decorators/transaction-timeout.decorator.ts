import { SetMetadata } from '@nestjs/common';

export const TRANSACTION_TIMEOUT_KEY = 'transactionTimeoutMs';

/**
 * Prazo maior para a transação da request (`TenantContextInterceptor`), só
 * em rotas que fazem várias chamadas de IA em sequência (ex.: gerar rascunho
 * com revisão e novas versões). O padrão continua 10s para todo o resto.
 */
export const TransactionTimeout = (milliseconds: number) => SetMetadata(TRANSACTION_TIMEOUT_KEY, milliseconds);
