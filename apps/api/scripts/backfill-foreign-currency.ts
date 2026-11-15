/**
 * Script one-off: marca as 2 recorrências já existentes da CazaTech que são
 * cobradas em dólar (Resend, Railway) com o valor nominal em USD, usando o
 * service real (`FinanceRecurringService.update`). Claude fica como está —
 * não é cobrada em USD, segundo o usuário.
 *
 * Uso: cd apps/api && npx ts-node --transpile-only scripts/backfill-foreign-currency.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { tenantContextStorage } from '../src/shared/context/tenant-context.storage';
import { FinanceRecurringService } from '../src/modules/finance/finance-recurring.service';
import type { FinanceActor } from '../src/modules/finance/finance.types';

const ORG_ID = '1c1f4686-45d4-45a8-97ba-731594b6341d'; // CazaTech
const OWNER_USER_ID = 'e7ac093e-5ae0-4a15-a05a-3439286b168c'; // ascefpam@gmail.com, OWNER
const ACTOR: FinanceActor = { type: 'USER', id: OWNER_USER_ID };

const BACKFILL: { id: string; foreignAmountCents: number; label: string }[] = [
  { id: '3813707e-d45f-46aa-8eb5-ecc9e2d3a9a1', foreignAmountCents: 2000, label: 'Resend (US$ 20,00/mês)' },
  { id: '84c9e4df-250c-4fa7-9c97-09f0366ea878', foreignAmountCents: 500, label: 'Railway (US$ 5,00/mês)' },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const prisma = app.get(PrismaService);
  const recurring = app.get(FinanceRecurringService);

  await prisma.runInTransaction((tx) =>
    tenantContextStorage.run(tx, async () => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${OWNER_USER_ID}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ORG_ID}, true)`;

      for (const row of BACKFILL) {
        const view = await recurring.update(
          ORG_ID,
          row.id,
          { foreignCurrency: 'USD', foreignAmountCents: row.foreignAmountCents },
          ACTOR,
        );
        console.log(`${row.label} -> foreignAmountCents=${view.foreignAmountCents}, foreignCurrency=${view.foreignCurrency}`);
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
