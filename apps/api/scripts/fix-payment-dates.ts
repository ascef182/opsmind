/**
 * Script one-off: corrige a DATA de 4 pagamentos que foram registrados hoje
 * (06/11/2026) com a data de hoje em vez da data real do recebimento —
 * não existe "editar data de pagamento", então a correção é
 * estornar (nunca apaga, só marca estornado) + registrar de novo com a
 * data certa.
 *
 * 1. Site do Thiago, parcela final de R$ 1.500,00 — usuário confirmou que
 *    entrou no final de maio/2026 (aproximado, "acho" nas próprias palavras).
 * 2. Mensalidade Cazarini Mail (Stripe), ago/set/out/2026, R$ 237,88 cada —
 *    usuário confirmou que a cobrança "cai automático" todo dia 17 (mesmo
 *    dia de cobrança do molde), então a data real de cada uma é o dia 17
 *    do próprio mês de referência, não 06/11.
 *
 * Uso: cd apps/api && npx ts-node --transpile-only scripts/fix-payment-dates.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { tenantContextStorage } from '../src/shared/context/tenant-context.storage';
import { FinanceEntriesService } from '../src/modules/finance/finance-entries.service';
import type { FinanceActor } from '../src/modules/finance/finance.types';

const ORG_ID = '1c1f4686-45d4-45a8-97ba-731594b6341d';
const OWNER_USER_ID = 'e7ac093e-5ae0-4a15-a05a-3439286b168c';
const ACTOR: FinanceActor = { type: 'USER', id: OWNER_USER_ID };
const REASON = 'Data corrigida: registrada com a data de hoje por engano, data real informada pelo usuário.';

const FIXES: { entryId: string; paymentId: string; amountCents: number; realDate: string; label: string }[] = [
  {
    entryId: '9bf5ee22-abc3-4fd8-8837-84ccfb6eb9f3',
    paymentId: 'db9be652-0b45-4cfa-a55c-c7c50196c3a0',
    amountCents: 150000,
    realDate: '2026-05-28',
    label: 'Site do Thiago — parcela final R$ 1.500,00 (final de maio, aproximado)',
  },
  {
    entryId: '5d5a38b6-44b2-4549-81df-110a9b170bc0',
    paymentId: '7df2997c-baa1-487b-a479-98dc2dfd3117',
    amountCents: 23788,
    realDate: '2026-08-17',
    label: 'Mensalidade Stripe ago/2026',
  },
  {
    entryId: '1f6a1714-9b25-4917-853f-71e84c4f6808',
    paymentId: 'fe5fdc28-f53e-4287-9bcc-6e41e73816b0',
    amountCents: 23788,
    realDate: '2026-09-17',
    label: 'Mensalidade Stripe set/2026',
  },
  {
    entryId: '7b9ac2a6-1314-41a4-b60a-81720c767ea9',
    paymentId: 'a8413547-c3f7-47f4-9d43-cb52d75cd261',
    amountCents: 23788,
    realDate: '2026-10-17',
    label: 'Mensalidade Stripe out/2026',
  },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const entries = app.get(FinanceEntriesService);

  await prisma.runInTransaction((tx) =>
    tenantContextStorage.run(tx, async () => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${OWNER_USER_ID}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ORG_ID}, true)`;

      for (const fix of FIXES) {
        const payment = await prisma.financialPayment.findFirst({ where: { id: fix.paymentId, entryId: fix.entryId } });
        if (!payment) {
          console.log(`${fix.label}: pagamento não encontrado, pulando.`);
          continue;
        }
        if (payment.reversedAt) {
          console.log(`${fix.label}: já estornado, pulando (idempotência).`);
          continue;
        }
        await entries.reversePayment(ORG_ID, fix.entryId, fix.paymentId, REASON, ACTOR);
        await entries.registerPayment(ORG_ID, fix.entryId, { amountCents: fix.amountCents, paidAt: fix.realDate }, ACTOR);
        console.log(`${fix.label}: estornado e re-registrado em ${fix.realDate}.`);
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
