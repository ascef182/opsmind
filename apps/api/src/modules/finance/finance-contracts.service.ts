import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Contract } from '@opsmind/database';
import {
  firstBillingMonth,
  fromDateKey,
  monthOf,
  outstandingCents,
  toDateKey,
  todayInSaoPaulo,
  type FinancialCategory,
} from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TasksService } from '../tasks/tasks.service';
import type {
  CreateContractDto,
  CreateContractFromDealDto,
  ListContractsQueryDto,
  UpdateContractDto,
} from './dto/contract.dto';
import { MAX_AMOUNT_CENTS } from './finance.constants';
import { FinanceRecurringService } from './finance-recurring.service';
import { toContractView } from './finance.mappers';
import type { ContractView, FinanceActor } from './finance.types';

// Tarefas de implantação criadas ao transformar um negócio ganho em contrato.
// Deliberadamente genéricas: a pessoa as ajusta; o ponto é que "ganhei" nunca
// termine num negócio fechado sem nenhuma próxima ação.
const IMPLEMENTATION_TASKS = [
  { title: 'Kickoff com o cliente', description: 'Alinhar escopo, prazos, responsáveis e canais de comunicação.' },
  { title: 'Levantar requisitos e acessos', description: 'Coletar acessos, materiais e integrações necessários para a implantação.' },
  { title: 'Configurar ambiente e primeira entrega', description: 'Preparar o ambiente e agendar a primeira entrega validável.' },
] as const;

/**
 * Contratos = receita CONTRATADA e, ao mesmo tempo, o "projeto" da
 * rentabilidade. Criar um contrato pode gerar a receita prevista (lançamento
 * PLANNED para pontuais, molde mensal para recorrentes) — a ponte
 * negócio -> contrato -> receita -> pagamento.
 */
@Injectable()
export class FinanceContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly recurringService: FinanceRecurringService,
    private readonly tasksService: TasksService,
  ) {}

  async list(organizationId: string, query: ListContractsQueryDto): Promise<ContractView[]> {
    const contracts = await this.prisma.contract.findMany({
      where: {
        organizationId,
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: { customer: { select: { name: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    if (contracts.length === 0) return [];

    const entries = await this.prisma.financialEntry.findMany({
      where: {
        organizationId,
        contractId: { in: contracts.map((c) => c.id) },
        direction: 'INCOME',
        status: { in: ['PENDING', 'PARTIAL', 'PAID'] },
      },
      select: { contractId: true, amountCents: true, paidCents: true, status: true },
    });

    const totals = new Map<string, { invoicedCents: number; receivedCents: number; outstandingCents: number }>();
    for (const e of entries) {
      if (!e.contractId) continue;
      const t = totals.get(e.contractId) ?? { invoicedCents: 0, receivedCents: 0, outstandingCents: 0 };
      t.invoicedCents += e.amountCents;
      t.receivedCents += e.paidCents;
      t.outstandingCents += outstandingCents(e);
      totals.set(e.contractId, t);
    }

    return contracts.map((c) =>
      toContractView(c, totals.get(c.id) ?? { invoicedCents: 0, receivedCents: 0, outstandingCents: 0 }),
    );
  }

  async findOne(organizationId: string, id: string): Promise<ContractView> {
    const [view] = (await this.list(organizationId, {})).filter((c) => c.id === id);
    if (!view) throw new NotFoundException('Contrato não encontrado');
    return view;
  }

  async create(organizationId: string, dto: CreateContractDto, actor: FinanceActor): Promise<ContractView> {
    await this.assertCustomer(organizationId, dto.customerId);
    if (dto.dealId) await this.assertDealOfCustomer(organizationId, dto.dealId, dto.customerId);
    if (dto.endDate && dto.endDate < dto.startDate) {
      throw new BadRequestException('A data final não pode ser anterior ao início');
    }
    if (dto.billing === 'ONE_TIME' && dto.billingDay !== undefined) {
      throw new BadRequestException('Dia de cobrança só se aplica a contratos mensais');
    }

    const billingDay = dto.billing === 'MONTHLY' ? (dto.billingDay ?? Number(dto.startDate.slice(8, 10))) : null;

    const contract = await this.prisma.contract.create({
      data: {
        organizationId,
        customerId: dto.customerId,
        dealId: dto.dealId ?? null,
        title: dto.title.trim(),
        category: dto.category,
        billing: dto.billing,
        valueCents: dto.valueCents,
        startDate: fromDateKey(dto.startDate),
        endDate: dto.endDate ? fromDateKey(dto.endDate) : null,
        billingDay,
        notes: dto.notes ?? null,
        actorType: actor.type,
        actorId: actor.id,
      },
    });

    if (dto.generateBilling !== false) {
      await this.generateBilling(organizationId, contract, dto.firstDueDate, actor);
    }

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'finance.contract.created',
      resource: `Contract:${contract.id}`,
      metadata: { billing: contract.billing, valueCents: contract.valueCents, dealId: contract.dealId },
    });

    return this.findOne(organizationId, contract.id);
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateContractDto,
    actor: FinanceActor,
  ): Promise<ContractView> {
    const current = await this.prisma.contract.findFirst({ where: { id, organizationId } });
    if (!current) throw new NotFoundException('Contrato não encontrado');
    if (current.status !== 'ACTIVE') {
      // Encerrado/cancelado é história; reabrir seria reescrever o passado.
      throw new ConflictException('Contrato encerrado ou cancelado não pode ser alterado');
    }

    const today = todayInSaoPaulo();
    const status = dto.status ?? current.status;
    let endDate: string | null =
      dto.endDate !== undefined ? dto.endDate : current.endDate ? toDateKey(current.endDate) : null;
    // Encerrar um mensal sem data final: termina hoje.
    if (status === 'COMPLETED' && current.billing === 'MONTHLY' && !endDate) endDate = today;
    if (endDate && endDate < toDateKey(current.startDate)) {
      throw new BadRequestException('A data final não pode ser anterior ao início');
    }

    const updated = await this.prisma.contract.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.valueCents !== undefined ? { valueCents: dto.valueCents } : {}),
        status,
        endDate: endDate ? fromDateKey(endDate) : null,
      },
    });

    // Mantém o molde mensal alinhado: valor novo e fim de vigência valem para
    // as próximas mensalidades; encerrar/cancelar desativa a geração.
    if (current.billing === 'MONTHLY') {
      await this.prisma.recurringEntry.updateMany({
        where: { organizationId, contractId: id },
        data: {
          ...(dto.valueCents !== undefined ? { amountCents: dto.valueCents } : {}),
          endMonth: endDate ? monthOf(endDate) : null,
          ...(status !== 'ACTIVE' ? { active: false } : {}),
        },
      });
    }
    if (status === 'CANCELLED') {
      // Só o que ainda não foi cobrado some do previsto. Cobranças já emitidas
      // seguem visíveis para a pessoa decidir (cancelar ou cobrar).
      await this.prisma.financialEntry.updateMany({
        where: { organizationId, contractId: id, status: 'PLANNED' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Contrato cancelado' },
      });
    }

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'finance.contract.updated',
      resource: `Contract:${id}`,
      metadata: { changed: Object.keys(dto), status: updated.status },
    });
    return this.findOne(organizationId, id);
  }

  /**
   * Negócio GANHO -> contrato + receita prevista + tarefas de implantação.
   * É a ponte que impede "ganhei o negócio" de ficar desconectado de "vou
   * receber por ele". Explícita (um clique), não automática: o valor do negócio
   * é uma estimativa de venda, e criar obrigação financeira sem confirmação
   * poria números não revisados nos relatórios.
   */
  async createFromDeal(
    organizationId: string,
    dealId: string,
    dto: CreateContractFromDealDto,
    actor: FinanceActor,
  ): Promise<{ contract: ContractView; tasksCreated: number }> {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, organizationId, deletedAt: null },
      include: { customer: { select: { name: true } } },
    });
    if (!deal) throw new NotFoundException('Negócio não encontrado');
    if (deal.stage !== 'WON') {
      throw new BadRequestException('Só negócios ganhos podem virar contrato');
    }
    if (deal.currency !== 'BRL') {
      throw new BadRequestException('O módulo financeiro opera apenas em BRL');
    }
    const existing = await this.prisma.contract.findFirst({
      where: { organizationId, dealId, status: { not: 'CANCELLED' } },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Este negócio já possui um contrato');

    const valueCents = dto.valueCents ?? Math.round(Number(deal.value) * 100);
    if (valueCents < 1) {
      throw new BadRequestException('O valor do negócio é zero — informe o valor do contrato');
    }
    if (valueCents > MAX_AMOUNT_CENTS) {
      throw new BadRequestException('Valor acima do limite suportado');
    }

    const contract = await this.create(
      organizationId,
      {
        customerId: deal.customerId,
        dealId,
        title: deal.title,
        category: dto.category ?? 'PROJECT',
        billing: dto.billing ?? 'ONE_TIME',
        valueCents,
        startDate: dto.startDate ?? todayInSaoPaulo(),
        billingDay: dto.billing === 'MONTHLY' ? dto.billingDay : undefined,
        firstDueDate: dto.firstDueDate,
      },
      actor,
    );

    let tasksCreated = 0;
    if (dto.createImplementationTasks !== false) {
      for (const task of IMPLEMENTATION_TASKS) {
        await this.tasksService.create(
          organizationId,
          { title: `${task.title} — ${deal.customer.name}`, description: task.description, customerId: deal.customerId },
          actor,
        );
        tasksCreated += 1;
      }
    }
    return { contract, tasksCreated };
  }

  // ── internos ─────────────────────────────────────────────────────────────

  /** ONE_TIME -> 1 lançamento PLANNED; MONTHLY -> molde de recorrência. */
  private async generateBilling(
    organizationId: string,
    contract: Contract,
    firstDueDate: string | undefined,
    actor: FinanceActor,
  ): Promise<void> {
    const startDate = toDateKey(contract.startDate);
    if (contract.billing === 'ONE_TIME') {
      await this.prisma.financialEntry.create({
        data: {
          organizationId,
          direction: 'INCOME',
          category: contract.category,
          description: contract.title,
          customerId: contract.customerId,
          contractId: contract.id,
          amountCents: contract.valueCents,
          status: 'PLANNED',
          issueDate: contract.startDate,
          dueDate: fromDateKey(firstDueDate ?? startDate),
          actorType: actor.type,
          actorId: actor.id,
        },
      });
      return;
    }
    const billingDay = contract.billingDay as number; // MONTHLY sempre tem (CHECK no banco).
    await this.recurringService.createForContract(
      organizationId,
      {
        id: contract.id,
        customerId: contract.customerId,
        title: contract.title,
        category: contract.category as FinancialCategory,
        valueCents: contract.valueCents,
        billingDay,
        firstMonth: firstBillingMonth(startDate, billingDay),
        endMonth: contract.endDate ? monthOf(toDateKey(contract.endDate)) : null,
      },
      actor,
    );
  }

  private async assertCustomer(organizationId: string, customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
  }

  private async assertDealOfCustomer(organizationId: string, dealId: string, customerId: string): Promise<void> {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, organizationId, deletedAt: null },
      select: { customerId: true },
    });
    if (!deal) throw new NotFoundException('Negócio não encontrado');
    if (deal.customerId !== customerId) {
      throw new BadRequestException('O negócio pertence a outro cliente');
    }
  }
}
