/**
 * Script one-off: corrige 2 lançamentos da CazaTech a pedido do usuário.
 *
 * 1. "Roca" (R$ 12.500,00, pessoal) — criado hoje (06/11/2026) mas o
 *    recebimento de verdade foi em 28/05/2026: corrige issueDate/dueDate
 *    pra data real e registra o pagamento nessa data.
 * 2. "Venda de moto" (Júnior Costa) — estava marcada como empresa (CNPJ),
 *    usuário confirmou que na verdade entrou na conta pessoal: corrige só
 *    o escopo (já está PAID, então os campos de valor/data permanecem
 *    intocados — só `scope` muda, que não é bloqueado em lançamento quitado).
 *
 * Uso: cd apps/api && npx ts-node --transpile-only scripts/fix-roca-and-moto.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { tenantContextStorage } from '../src/shared/context/tenant-context.storage';
import { FinanceEntriesService } from '../src/modules/finance/finance-entries.service';
import type { FinanceActor } from '../src/modules/finance/finance.types';

const ORG_ID = '1c1f4686-45d4-45a8-97ba-731594b6341d'; // CazaTech
const OWNER_USER_ID = 'e7ac093e-5ae0-4a15-a05a-3439286b168c'; // ascefpam@gmail.com, OWNER
const ACTOR: FinanceActor = { type: 'USER', id: OWNER_USER_ID };

const ROCA_ENTRY_ID = 'd09451d5-3ecf-48a1-9e65-89738eaefc58';
const MOTO_ENTRY_ID = 'a733ab79-5cd7-4397-95a4-c91cdfad13ed';
const ROCA_DATE = '2026-05-28';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const entries = app.get(FinanceEntriesService);

  await prisma.runInTransaction((tx) =>
    tenantContextStorage.run(tx, async () => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${OWNER_USER_ID}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ORG_ID}, true)`;

      const roca = await prisma.financialEntry.findFirst({ where: { id: ROCA_ENTRY_ID, organizationId: ORG_ID } });
      if (!roca) throw new Error('Lançamento da Roca não encontrado');
      if (roca.status === 'PENDING') {
        await entries.update(ORG_ID, ROCA_ENTRY_ID, { issueDate: ROCA_DATE, dueDate: ROCA_DATE }, ACTOR);
        await entries.registerPayment(ORG_ID, ROCA_ENTRY_ID, { amountCents: roca.amountCents, paidAt: ROCA_DATE }, ACTOR);
        console.log(`Roca: issueDate/dueDate -> ${ROCA_DATE}, pago ${roca.amountCents} centavos.`);
      } else {
        console.log(`Roca: status já é ${roca.status}, nada feito (idempotência).`);
      }

      const moto = await prisma.financialEntry.findFirst({ where: { id: MOTO_ENTRY_ID, organizationId: ORG_ID } });
      if (!moto) throw new Error('Lançamento da moto não encontrado');
      if (moto.scope !== 'PERSONAL') {
        await entries.update(ORG_ID, MOTO_ENTRY_ID, { scope: 'PERSONAL' }, ACTOR);
        console.log('Moto: escopo -> PERSONAL.');
      } else {
        console.log('Moto: escopo já é PERSONAL, nada feito (idempotência).');
      }
    }),
  );

  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
