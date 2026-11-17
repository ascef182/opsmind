import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_TRANSACTION_KEY = 'skipTenantTransaction';

// Rotas de longa duração (stream SSE) não podem segurar a transação da request:
// os guards continuam validando usuário e organização, mas nenhuma transação é
// aberta. A rota não pode tocar no banco pelo proxy do Prisma.
export const SkipTenantTransaction = () => SetMetadata(SKIP_TENANT_TRANSACTION_KEY, true);
