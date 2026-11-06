/**
 * Script one-off: cadastra o histórico financeiro real da CazaTech (maio a
 * novembro/2026) usando exclusivamente os services já existentes do módulo
 * financeiro (nenhuma regra de negócio reimplementada aqui).
 *
 * Replica manualmente o que `TenantContextInterceptor` faz por request HTTP
 * (abre uma transação, seta `app.current_user_id`/`app.current_org_id` via
 * `SET LOCAL`, publica a transação em `tenantContextStorage`) porque este
 * script não passa por nenhuma rota — ver
 * `apps/api/src/shared/interceptors/tenant-context.interceptor.ts`.
 *
 * Idempotente: pode ser re-executado sem duplicar nada (cliente por nome
 * exato, contrato por cliente+título, lançamento por
 * cliente+descrição+valor+data de emissão).
 *
 * Uso: cd apps/api && npx tsx scripts/import-cazatech-finance-history.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import type { Customer } from '@opsmind/database';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { tenantContextStorage } from '../src/shared/context/tenant-context.storage';
import { CustomersService } from '../src/modules/customers/customers.service';
import { FinanceContractsService } from '../src/modules/finance/finance-contracts.service';
import { FinanceEntriesService } from '../src/modules/finance/finance-entries.service';
import { FinanceRecurringService } from '../src/modules/finance/finance-recurring.service';
import type { FinanceActor } from '../src/modules/finance/finance.types';

const ORG_ID = '1c1f4686-45d4-45a8-97ba-731594b6341d'; // CazaTech
const OWNER_USER_ID = 'e7ac093e-5ae0-4a15-a05a-3439286b168c'; // ascefpam@gmail.com, OWNER
const ACTOR: FinanceActor = { type: 'USER', id: OWNER_USER_ID };

const log: { type: string; id: string; detail: string }[] = [];
function record(type: string, id: string, detail: string) {
  log.push({ type, id, detail });
}

async function main() {
  const app: INestApplicationContext = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const prisma = app.get(PrismaService);
  const customersService = app.get(CustomersService);
  const contractsService = app.get(FinanceContractsService);
  const entriesService = app.get(FinanceEntriesService);
  const recurringService = app.get(FinanceRecurringService);

  await prisma.runInTransaction((tx) =>
    tenantContextStorage.run(tx, async () => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${OWNER_USER_ID}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ORG_ID}, true)`;

      // ── 1. Clientes ──────────────────────────────────────────────────────

      async function getOrCreateCustomer(
        name: string,
        extra: { company?: string } = {},
      ): Promise<Customer> {
        const existing = await prisma.customer.findFirst({
          where: { organizationId: ORG_ID, name, deletedAt: null },
        });
        if (existing) {
          record('customer.reused', existing.id, name);
          return existing;
        }
        const created = await customersService.create(
          ORG_ID,
          { name, status: 'ACTIVE', ...extra },
          OWNER_USER_ID,
        );
        record('customer.created', created.id, name);
        return created;
      }

      const igorReis = await getOrCreateCustomer('Igor Reis');
      const ferreiras = await getOrCreateCustomer('Ferreiras Confecções');
      const jess = await getOrCreateCustomer('Jess');
      const juniorCosta = await getOrCreateCustomer('Júnior Costa');
      const liame = await getOrCreateCustomer('Liame');
      const ale = await getOrCreateCustomer('Ale', { company: '2 IMPAR' });

      // Clientes já existentes, confirmados com o usuário como a mesma pessoa.
      const paula = await customersService.update(
        ORG_ID,
        'ba64654c-faaf-49b6-8271-a8bcfcd9b90e',
        { company: 'Gera Acesso e Diálogo', status: 'ACTIVE' },
        OWNER_USER_ID,
      );
      record('customer.updated', paula.id, 'Paula -> empresa Gera Acesso e Diálogo');

      const thiago = await customersService.update(
        ORG_ID,
        'a8b0337b-ee06-43cb-b8e8-b33f53b2e885',
        { name: 'Thiago Marques', status: 'ACTIVE' },
        OWNER_USER_ID,
      );
      record('customer.updated', thiago.id, 'Thiago -> nome Thiago Marques');

      const celioCurrent = await customersService.findByIdOrThrow(ORG_ID, 'c0840a75-dbdd-45ff-9003-5788274f558e');
      const celioTags = new Set(celioCurrent.tags);
      celioTags.add('Entrelace');
      const celio = await customersService.update(
        ORG_ID,
        celioCurrent.id,
        { tags: [...celioTags], status: 'ACTIVE' },
        OWNER_USER_ID,
      );
      record('customer.updated', celio.id, 'Celio -> tag Entrelace + status ACTIVE');

      // Cliente "Rubim" (49b27eac-...) é deliberadamente deixado intocado —
      // provável duplicata do Celio, sinalizada no relatório final.

      // ── 2. Lançamentos independentes (sem contrato, já recebidos) ────────

      async function getOrCreatePaidEntry(input: {
        customerId: string;
        category: Parameters<typeof entriesService.create>[1]['category'];
        description: string;
        amountCents: number;
        date: string;
        scope?: 'BUSINESS' | 'PERSONAL';
        notes?: string;
      }) {
        const existing = await prisma.financialEntry.findFirst({
          where: {
            organizationId: ORG_ID,
            customerId: input.customerId,
            description: input.description,
            amountCents: input.amountCents,
          },
        });
        if (existing) {
          record('entry.reused', existing.id, input.description);
          return existing;
        }

        const entry = await entriesService.create(
          ORG_ID,
          {
            direction: 'INCOME',
            category: input.category,
            scope: input.scope ?? 'BUSINESS',
            description: input.description,
            customerId: input.customerId,
            amountCents: input.amountCents,
            issueDate: input.date,
            dueDate: input.date,
            status: 'PENDING',
            notes: input.notes,
          },
          ACTOR,
        );
        await entriesService.registerPayment(
          ORG_ID,
          entry.id,
          { amountCents: input.amountCents, paidAt: input.date },
          ACTOR,
        );
        record('entry.created+paid', entry.id, input.description);
        return entry;
      }

      // MAIO
      await getOrCreatePaidEntry({
        customerId: igorReis.id,
        category: 'DEVELOPMENT',
        description: 'Desenvolvimento de site',
        amountCents: 30_000,
        date: '2026-05-29',
      });
      await getOrCreatePaidEntry({
        customerId: ferreiras.id,
        category: 'PRODUCT_SALE',
        description: "Venda de uma caixa d'água",
        amountCents: 100_000,
        date: '2026-05-28',
      });
      await getOrCreatePaidEntry({
        customerId: jess.id,
        category: 'OTHER_INCOME',
        description: 'Freelancer realizado em São Tomé',
        amountCents: 33_800,
        date: '2026-05-05',
        notes: "Cliente identificado anteriormente como 'Jazz' — nome correto: Jess.",
      });
      await getOrCreatePaidEntry({
        customerId: paula.id,
        category: 'DEVELOPMENT',
        description: 'Desenvolvimento de site (Gera Acesso e Diálogo)',
        amountCents: 120_000,
        date: '2026-05-04',
      });

      // JUNHO
      await getOrCreatePaidEntry({
        customerId: juniorCosta.id,
        category: 'PERSONAL_ASSET_SALE',
        description: 'Venda de moto (ativo pessoal — não é faturamento operacional da CazaTech)',
        amountCents: 1_200_000,
        date: '2026-06-03',
      });
      await getOrCreatePaidEntry({
        customerId: ferreiras.id,
        category: 'PRODUCT_SALE',
        description: 'Venda de uma bomba',
        amountCents: 110_000,
        date: '2026-06-08',
      });
      await getOrCreatePaidEntry({
        customerId: thiago.id,
        category: 'ADDITIONAL_SERVICE',
        description: 'Suporte e relatórios do site',
        amountCents: 65_550,
        date: '2026-06-26',
        notes: 'Serviço distinto do contrato de desenvolvimento do site (R$ 2.500) — não confundir com ele.',
      });

      // JULHO
      await getOrCreatePaidEntry({
        customerId: thiago.id,
        category: 'PROJECT',
        description: 'Desenvolvimento do sistema Cazarini Mail',
        amountCents: 300_000,
        date: '2026-07-18',
      });

      // SETEMBRO
      await getOrCreatePaidEntry({
        customerId: celio.id,
        category: 'PROJECT',
        description: 'Serviço/projeto (legenda/operação)',
        amountCents: 223_240,
        date: '2026-09-15',
        notes: "Identificado anteriormente como 'Rubim'; cliente efetivo é Celio (empresa RUBIM).",
      });

      // OUTUBRO
      await getOrCreatePaidEntry({
        customerId: celio.id,
        category: 'PROJECT',
        description: 'Serviço/projeto (pagamento identificado como "Entrelace")',
        amountCents: 1_045_181,
        date: '2026-10-06',
        notes: "Pagamento chegou identificado como 'Entrelace' — cliente efetivo é Celio.",
      });
      await getOrCreatePaidEntry({
        customerId: liame.id,
        category: 'OTHER_INCOME',
        description: 'Trabalho realizado para 4 Estações',
        amountCents: 26_500,
        date: '2026-10-30',
        scope: 'PERSONAL',
        notes: 'Recebido na conta pessoal, não no CNPJ.',
      });
      await getOrCreatePaidEntry({
        customerId: liame.id,
        category: 'OTHER_INCOME',
        description: 'Trabalho referente à Mostra Internacional de Cinema',
        amountCents: 34_000,
        date: '2026-10-21',
        scope: 'PERSONAL',
        notes: 'Recebido na conta pessoal, não no CNPJ.',
      });

      // NOVEMBRO
      await getOrCreatePaidEntry({
        customerId: celio.id,
        category: 'PROJECT',
        description: 'Serviço/projeto',
        amountCents: 550_800,
        date: '2026-11-04',
      });

      // ── 3. Contratos (saldo em aberto ou recorrência real) ────────────────

      async function getOrCreateContract(dto: Parameters<typeof contractsService.create>[1]) {
        const existing = await prisma.contract.findFirst({
          where: { organizationId: ORG_ID, customerId: dto.customerId, title: dto.title },
        });
        if (existing) {
          record('contract.reused', existing.id, dto.title);
          return existing;
        }
        const view = await contractsService.create(ORG_ID, dto, ACTOR);
        record('contract.created', view.id, dto.title);
        return prisma.contract.findUniqueOrThrow({ where: { id: view.id } });
      }

      // Thiago — site original: contratado R$ 2.500, parcial R$ 1.000 em jun/2026.
      const thiagoSiteContract = await getOrCreateContract({
        customerId: thiago.id,
        title: 'Desenvolvimento de site',
        category: 'DEVELOPMENT',
        billing: 'ONE_TIME',
        valueCents: 250_000,
        startDate: '2026-06-25',
        notes: 'Site contratado por R$ 2.500,00. R$ 1.000,00 recebido em 25/06/2026 — R$ 1.500,00 em aberto.',
      });
      const thiagoSiteEntry = await prisma.financialEntry.findFirst({
        where: { organizationId: ORG_ID, contractId: thiagoSiteContract.id },
      });
      if (thiagoSiteEntry && thiagoSiteEntry.status === 'PLANNED') {
        // `issue()` sempre grava issueDate = hoje (correto para faturar em
        // tempo real) — errado aqui, que é um lançamento histórico. Corrige
        // na sequência com `update()` (permitido: status ainda não é PAID).
        await entriesService.issue(ORG_ID, thiagoSiteEntry.id, {}, ACTOR);
        await entriesService.update(ORG_ID, thiagoSiteEntry.id, { issueDate: '2026-06-25' }, ACTOR);
        await entriesService.registerPayment(
          ORG_ID,
          thiagoSiteEntry.id,
          { amountCents: 100_000, paidAt: '2026-06-25' },
          ACTOR,
        );
        record('entry.partial-paid', thiagoSiteEntry.id, 'Site Thiago — parcial R$ 1.000,00');
      } else if (thiagoSiteEntry) {
        // Idempotência: se já existia (ex.: execução anterior antes deste
        // ajuste), garante o issueDate correto mesmo sem recriar nada.
        const key = thiagoSiteEntry.issueDate.toISOString().slice(0, 10);
        if (key !== '2026-06-25') {
          await entriesService.update(ORG_ID, thiagoSiteEntry.id, { issueDate: '2026-06-25' }, ACTOR);
          record('entry.issueDate-corrected', thiagoSiteEntry.id, 'Site Thiago — issueDate corrigido para 2026-06-25');
        }
      }

      // Thiago — mensalidade Cazarini Mail via Stripe: contrato sem geração
      // automática (para poder setar supplierName="Stripe" desde o molde),
      // depois recorrência criada diretamente.
      const thiagoMensalidadeContract = await getOrCreateContract({
        customerId: thiago.id,
        title: 'Mensalidade Cazarini Mail (Stripe)',
        category: 'SAAS',
        billing: 'MONTHLY',
        valueCents: 23_788,
        startDate: '2026-08-17',
        generateBilling: false,
        notes: 'Mensalidade do sistema Cazarini Mail, recebida pela Stripe.',
      });
      const existingRecurring = await prisma.recurringEntry.findFirst({
        where: { organizationId: ORG_ID, contractId: thiagoMensalidadeContract.id },
      });
      if (!existingRecurring) {
        const recurringView = await recurringService.create(
          ORG_ID,
          {
            direction: 'INCOME',
            category: 'SAAS',
            description: 'Mensalidade Cazarini Mail (Stripe)',
            supplierName: 'Stripe',
            amountCents: 23_788,
            dayOfMonth: 17,
            startMonth: '2026-08',
            customerId: thiago.id,
            contractId: thiagoMensalidadeContract.id,
          },
          ACTOR,
        );
        record('recurring.created', recurringView.id, 'Mensalidade Cazarini Mail (Stripe)');
        record(
          'recurring.note',
          recurringView.id,
          'Entradas geradas (ago–nov/2026) ficam PENDING — sem histórico de pagamento da Stripe disponível para confirmar, conforme pedido do usuário.',
        );
      } else {
        record('recurring.reused', existingRecurring.id, 'Mensalidade Cazarini Mail (Stripe)');
      }

      // Celio — site antigo: contratado R$ 500, R$ 250 recebido, R$ 250 em
      // aberto. Data real desconhecida ("ano passado") — 06/11/2026 é data de
      // controle por decisão explícita do usuário, não o fato real.
      const celioSiteContract = await getOrCreateContract({
        customerId: celio.id,
        title: 'Desenvolvimento de site (histórico)',
        category: 'DEVELOPMENT',
        billing: 'ONE_TIME',
        valueCents: 50_000,
        startDate: '2026-11-06',
        notes:
          'Site contratado por R$ 500,00, R$ 250,00 recebido ("ano passado", data real não confirmada). ' +
          'Data de início/vencimento (06/11/2026) é uma DATA DE CONTROLE usada por decisão explícita do ' +
          'usuário — a data real do fato é desconhecida e está PENDENTE DE CONFIRMAÇÃO.',
      });
      const celioSiteEntry = await prisma.financialEntry.findFirst({
        where: { organizationId: ORG_ID, contractId: celioSiteContract.id },
      });
      if (celioSiteEntry && celioSiteEntry.status === 'PLANNED') {
        // Mesma ressalva do site do Thiago: `issue()` grava issueDate = hoje.
        // Aqui coincide com a data de controle (06/11/2026) só porque o
        // script rodou nesse dia — fixamos explicitamente para não depender
        // da data de execução em uma re-rodada futura.
        await entriesService.issue(ORG_ID, celioSiteEntry.id, {}, ACTOR);
        await entriesService.update(ORG_ID, celioSiteEntry.id, { issueDate: '2026-11-06' }, ACTOR);
        await entriesService.registerPayment(
          ORG_ID,
          celioSiteEntry.id,
          { amountCents: 25_000, paidAt: '2026-11-06' },
          ACTOR,
        );
        record('entry.partial-paid', celioSiteEntry.id, 'Site Celio (histórico) — parcial R$ 250,00');
      } else if (celioSiteEntry) {
        const key = celioSiteEntry.issueDate.toISOString().slice(0, 10);
        if (key !== '2026-11-06') {
          await entriesService.update(ORG_ID, celioSiteEntry.id, { issueDate: '2026-11-06' }, ACTOR);
          record('entry.issueDate-corrected', celioSiteEntry.id, 'Site Celio (histórico) — issueDate corrigido');
        }
      }

      // Ale — implantação: tudo pendente de fechamento, nada pago ainda.
      await getOrCreateContract({
        customerId: ale.id,
        title: 'Implantação do sistema',
        category: 'IMPLEMENTATION',
        billing: 'ONE_TIME',
        valueCents: 579_000,
        startDate: '2026-11-29',
        notes:
          'Valor de tabela R$ 6.900,00; desconto de R$ 1.110,00 porque logo e VPS ficam por conta da ' +
          "associação \"Estudo e Pesquisa em Cannabis Medicinal\". Pagamento em 3x de R$ 1.930,00 " +
          '(29/11/2026, 29/12/2026, 29/01/2027). Tudo pendente de fechamento — nada pago ainda.',
      });

      // Ale — mensalidade: só entra em vigor em janeiro/2027 (mês futuro —
      // não gera nenhum lançamento ainda, corretamente).
      await getOrCreateContract({
        customerId: ale.id,
        title: 'Mensalidade',
        category: 'MONTHLY_FEE',
        billing: 'MONTHLY',
        valueCents: 60_000,
        startDate: '2027-01-20',
        notes: 'Mensalidade entra em vigor a partir da entrada em funcionamento do sistema, em 20/01/2027.',
      });
    }),
  );

  // ── 4. Checagem de sanidade (mesmo padrão de contexto de tenant, só leitura) ─

  const { FinanceReportsService } = await import('../src/modules/finance/finance-reports.service');
  const reports = app.get(FinanceReportsService);
  await prisma.runInTransaction((tx) =>
    tenantContextStorage.run(tx, async () => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${OWNER_USER_ID}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${ORG_ID}, true)`;
      for (const month of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']) {
        const overview = await reports.overview(ORG_ID, { month });
        record(
          'sanity.overview',
          month,
          `recebido=${overview.summary.receivedCents} pessoal.recebido=${overview.personal.summary.receivedCents}`,
        );
      }
    }),
  );

  console.log(JSON.stringify(log, null, 2));
  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
