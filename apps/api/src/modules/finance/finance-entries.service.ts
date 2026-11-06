import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@opsmind/database';
import {
  fromDateKey,
  isCategoryOfDirection,
  statusFromPaid,
  todayInSaoPaulo,
  type FinancialCategory,
  type FinancialDirection,
  type FinancialScope,
} from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateEntryDto,
  IssueEntryDto,
  ListEntriesQueryDto,
  RegisterPaymentDto,
  UpdateEntryDto,
} from './dto/entry.dto';
import { toEntryView, type EntryWithRelations } from './finance.mappers';
import type { FinanceActor, FinancialEntryView } from './finance.types';

const ENTRY_INCLUDE = {
  customer: { select: { name: true } },
  contract: { select: { title: true } },
} satisfies Prisma.FinancialEntryInclude;

/**
 * Lançamentos (contas a receber / a pagar) e seus pagamentos.
 *
 * INVARIANTE CENTRAL: `paidCents`, `status` e `settledAt` de um lançamento
 * são SEMPRE derivados dos pagamentos não estornados, por `applyPaidState()`,
 * na mesma transação que grava/estorna o pagamento. Nenhum endpoint aceita
 * esses campos do cliente. Assim o saldo nunca diverge do histórico.
 *
 * Nada é apagado: lançamento é cancelado, pagamento é estornado.
 */
@Injectable()
export class FinanceEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateEntryDto, actor: FinanceActor): Promise<FinancialEntryView> {
    this.assertCategory(dto.direction, dto.category);
    const feesCents = dto.feesCents ?? 0;
    if (dto.direction === 'EXPENSE' && feesCents > 0) {
      throw new BadRequestException('Taxas se aplicam apenas a receitas');
    }
    if (feesCents > dto.amountCents) {
      throw new BadRequestException('As taxas não podem ser maiores que o valor do lançamento');
    }
    if (dto.scope === 'PERSONAL' && dto.contractId) {
      throw new BadRequestException('Lançamento pessoal não pode estar vinculado a um contrato (contrato é sempre da empresa)');
    }
    this.assertForeignFields(dto, dto.amountCents);
    const links = await this.resolveLinks(organizationId, dto.customerId, dto.contractId);
    const today = todayInSaoPaulo();

    const entry = await this.prisma.financialEntry.create({
      data: {
        organizationId,
        direction: dto.direction,
        category: dto.category,
        scope: dto.scope ?? 'BUSINESS',
        description: dto.description.trim(),
        supplierName: dto.supplierName?.trim() || null,
        customerId: links.customerId,
        contractId: links.contractId,
        amountCents: dto.amountCents,
        feesCents,
        foreignCurrency: dto.foreignCurrency ?? null,
        foreignAmountCents: dto.foreignAmountCents ?? null,
        exchangeRate: dto.exchangeRate ?? null,
        iofCents: dto.iofCents ?? null,
        status: dto.status ?? 'PENDING',
        issueDate: fromDateKey(dto.issueDate ?? today),
        dueDate: fromDateKey(dto.dueDate),
        notes: dto.notes ?? null,
        actorType: actor.type,
        actorId: actor.id,
      },
      include: ENTRY_INCLUDE,
    });

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'finance.entry.created',
      resource: `FinancialEntry:${entry.id}`,
      metadata: { direction: entry.direction, category: entry.category, amountCents: entry.amountCents },
    });

    return toEntryView(entry, today);
  }

  async list(organizationId: string, query: ListEntriesQueryDto): Promise<FinancialEntryView[]> {
    const today = todayInSaoPaulo();
    const where: Prisma.FinancialEntryWhereInput = {
      organizationId,
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.contractId ? { contractId: query.contractId } : {}),
      ...(query.from || query.to
        ? {
            dueDate: {
              ...(query.from ? { gte: fromDateKey(query.from) } : {}),
              ...(query.to ? { lte: fromDateKey(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { description: { contains: query.search, mode: 'insensitive' as const } },
              { supplierName: { contains: query.search, mode: 'insensitive' as const } },
              { customer: { name: { contains: query.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    if (query.status === 'OVERDUE') {
      // Derivado: ainda tem saldo e venceu antes de hoje (ver isOverdue).
      where.status = { in: ['PENDING', 'PARTIAL'] };
      where.dueDate = { ...(where.dueDate as object | undefined), lt: fromDateKey(today) };
    } else if (query.status) {
      where.status = query.status;
    }

    const entries = await this.prisma.financialEntry.findMany({
      where,
      include: ENTRY_INCLUDE,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      take: query.limit,
      skip: query.offset,
    });
    return entries.map((e) => toEntryView(e, today));
  }

  async findOne(organizationId: string, id: string): Promise<FinancialEntryView> {
    const entry = await this.prisma.financialEntry.findFirst({
      where: { id, organizationId },
      include: { ...ENTRY_INCLUDE, payments: { orderBy: { paidAt: 'asc' } } },
    });
    if (!entry) throw new NotFoundException('Lançamento não encontrado');
    return toEntryView(entry, todayInSaoPaulo());
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateEntryDto,
    actor: FinanceActor,
  ): Promise<FinancialEntryView> {
    const current = await this.getRaw(organizationId, id);
    if (current.status === 'CANCELLED') {
      throw new ConflictException('Lançamento cancelado não pode ser editado');
    }

    const touchesMoney =
      dto.amountCents !== undefined ||
      dto.feesCents !== undefined ||
      dto.issueDate !== undefined ||
      dto.dueDate !== undefined ||
      dto.foreignCurrency !== undefined ||
      dto.foreignAmountCents !== undefined ||
      dto.exchangeRate !== undefined ||
      dto.iofCents !== undefined;
    // Lançamento quitado é história: só descrição, vínculos e observações.
    if (current.status === 'PAID' && touchesMoney) {
      throw new ConflictException('Lançamento quitado não pode ter valor ou datas alterados — estorne o pagamento primeiro');
    }

    const category = (dto.category ?? current.category) as FinancialCategory;
    this.assertCategory(current.direction, category);
    const scope = (dto.scope ?? current.scope) as FinancialScope;

    const amountCents = dto.amountCents ?? current.amountCents;
    const feesCents = dto.feesCents ?? current.feesCents;
    if (amountCents < current.paidCents) {
      throw new BadRequestException('O valor não pode ficar abaixo do que já foi pago');
    }
    if (feesCents > amountCents) {
      throw new BadRequestException('As taxas não podem ser maiores que o valor do lançamento');
    }
    if (current.direction === 'EXPENSE' && feesCents > 0) {
      throw new BadRequestException('Taxas se aplicam apenas a receitas');
    }

    const foreign = {
      foreignCurrency: dto.foreignCurrency !== undefined ? dto.foreignCurrency : current.foreignCurrency,
      foreignAmountCents: dto.foreignAmountCents !== undefined ? dto.foreignAmountCents : current.foreignAmountCents,
      exchangeRate: dto.exchangeRate !== undefined ? dto.exchangeRate : current.exchangeRate?.toNumber() ?? null,
      iofCents: dto.iofCents !== undefined ? dto.iofCents : current.iofCents,
    };
    this.assertForeignFields(foreign, amountCents);

    // Vínculo: contrato implica o cliente do contrato. Desvincular contrato
    // (null) mantém o cliente já gravado, salvo se o cliente também vier.
    const customerInput = dto.customerId !== undefined ? dto.customerId : current.customerId;
    const contractInput = dto.contractId !== undefined ? dto.contractId : current.contractId;
    if (scope === 'PERSONAL' && contractInput) {
      throw new BadRequestException('Lançamento pessoal não pode estar vinculado a um contrato (contrato é sempre da empresa)');
    }
    const links = await this.resolveLinks(organizationId, customerInput ?? undefined, contractInput ?? undefined);

    const updated = await this.prisma.runInTransaction(async (tx) => {
      await this.lockEntry(tx, id);
      await tx.financialEntry.update({
        where: { id },
        data: {
          category,
          scope,
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.supplierName !== undefined ? { supplierName: dto.supplierName?.trim() || null } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.issueDate !== undefined ? { issueDate: fromDateKey(dto.issueDate) } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: fromDateKey(dto.dueDate) } : {}),
          amountCents,
          feesCents,
          foreignCurrency: foreign.foreignCurrency,
          foreignAmountCents: foreign.foreignAmountCents,
          exchangeRate: foreign.exchangeRate,
          iofCents: foreign.iofCents,
          customerId: links.customerId,
          contractId: links.contractId,
        },
      });
      // O valor pode ter caído até igualar o que já foi pago (vira PAID).
      return this.applyPaidState(tx, id);
    });

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'finance.entry.updated',
      resource: `FinancialEntry:${id}`,
      metadata: { changed: Object.keys(dto) },
    });

    return toEntryView(updated, todayInSaoPaulo());
  }

  /** PLANNED -> PENDING: o que estava previsto passa a ser cobrado de fato. */
  async issue(
    organizationId: string,
    id: string,
    dto: IssueEntryDto,
    actor: FinanceActor,
  ): Promise<FinancialEntryView> {
    const current = await this.getRaw(organizationId, id);
    if (current.status !== 'PLANNED') {
      throw new ConflictException('Só lançamentos previstos podem ser emitidos');
    }
    const today = todayInSaoPaulo();
    const result = await this.prisma.financialEntry.updateMany({
      where: { id, organizationId, status: 'PLANNED' },
      data: {
        status: 'PENDING',
        issueDate: fromDateKey(today),
        ...(dto.dueDate ? { dueDate: fromDateKey(dto.dueDate) } : {}),
      },
    });
    if (result.count === 0) throw new ConflictException('O lançamento mudou de estado — recarregue');

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'finance.entry.issued',
      resource: `FinancialEntry:${id}`,
    });
    return this.findOne(organizationId, id);
  }

  async cancel(organizationId: string, id: string, reason: string, actor: FinanceActor): Promise<FinancialEntryView> {
    const current = await this.getRaw(organizationId, id);
    if (current.status === 'CANCELLED') throw new ConflictException('Lançamento já está cancelado');
    if (current.paidCents > 0) {
      throw new ConflictException('Há pagamentos neste lançamento — estorne-os antes de cancelar');
    }

    const result = await this.prisma.financialEntry.updateMany({
      where: { id, organizationId, paidCents: 0, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.trim() },
    });
    if (result.count === 0) throw new ConflictException('O lançamento mudou de estado — recarregue');

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'finance.entry.cancelled',
      resource: `FinancialEntry:${id}`,
      metadata: { reason: reason.trim() },
    });
    return this.findOne(organizationId, id);
  }

  async registerPayment(
    organizationId: string,
    entryId: string,
    dto: RegisterPaymentDto,
    actor: FinanceActor,
  ): Promise<FinancialEntryView> {
    const today = todayInSaoPaulo();
    const paidAt = dto.paidAt ?? today;
    if (paidAt > today) {
      throw new BadRequestException('A data do pagamento não pode estar no futuro');
    }
    // Existência/organização checadas antes de abrir a transação com lock.
    await this.getRaw(organizationId, entryId);

    await this.prisma.runInTransaction(async (tx) => {
      // Duas baixas simultâneas do mesmo lançamento não podem somar acima do valor.
      await this.lockEntry(tx, entryId);
      const entry = await tx.financialEntry.findFirst({ where: { id: entryId, organizationId } });
      if (!entry) throw new NotFoundException('Lançamento não encontrado');
      if (entry.status === 'CANCELLED') throw new ConflictException('Lançamento cancelado não recebe pagamentos');
      // Previsto != cobrado: dinheiro só entra em lançamento já faturado (emitido).
      if (entry.status === 'PLANNED') throw new ConflictException('Fature o lançamento previsto antes de registrar pagamento');

      const remaining = entry.amountCents - entry.paidCents;
      if (dto.amountCents > remaining) {
        throw new BadRequestException(`O valor excede o saldo em aberto (${remaining} centavos)`);
      }

      await tx.financialPayment.create({
        data: {
          organizationId,
          entryId,
          amountCents: dto.amountCents,
          paidAt: fromDateKey(paidAt),
          method: dto.method?.trim() || null,
          note: dto.note?.trim() || null,
          actorType: actor.type,
          actorId: actor.id,
        },
      });
      await this.applyPaidState(tx, entryId);
    });

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'finance.payment.registered',
      resource: `FinancialEntry:${entryId}`,
      metadata: { amountCents: dto.amountCents, paidAt },
    });
    return this.findOne(organizationId, entryId);
  }

  /** Estorno = contra-lançamento: o pagamento fica no histórico, marcado. */
  async reversePayment(
    organizationId: string,
    entryId: string,
    paymentId: string,
    reason: string,
    actor: FinanceActor,
  ): Promise<FinancialEntryView> {
    await this.getRaw(organizationId, entryId);

    await this.prisma.runInTransaction(async (tx) => {
      await this.lockEntry(tx, entryId);
      const payment = await tx.financialPayment.findFirst({
        where: { id: paymentId, entryId, organizationId },
      });
      if (!payment) throw new NotFoundException('Pagamento não encontrado');
      if (payment.reversedAt) throw new ConflictException('Pagamento já foi estornado');

      await tx.financialPayment.update({
        where: { id: paymentId },
        data: { reversedAt: new Date(), reverseReason: reason.trim() },
      });
      await this.applyPaidState(tx, entryId);
    });

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'finance.payment.reversed',
      resource: `FinancialEntry:${entryId}`,
      metadata: { paymentId, reason: reason.trim() },
    });
    return this.findOne(organizationId, entryId);
  }

  // ── internos ─────────────────────────────────────────────────────────────

  /**
   * Mesma regra do CHECK em `financial_entries` (defesa em profundidade):
   * moeda+valor nominal vêm em par, cotação/IOF só fazem sentido com uma
   * moeda estrangeira já registrada, e o IOF nunca passa do total cobrado.
   */
  private assertForeignFields(
    dto: { foreignCurrency?: string | null; foreignAmountCents?: number | null; exchangeRate?: number | null; iofCents?: number | null },
    amountCents: number,
  ): void {
    const hasCurrency = dto.foreignCurrency != null;
    const hasForeignAmount = dto.foreignAmountCents != null;
    if (hasCurrency !== hasForeignAmount) {
      throw new BadRequestException('Moeda estrangeira e valor nominal precisam vir juntos');
    }
    if ((dto.exchangeRate != null || dto.iofCents != null) && !hasCurrency) {
      throw new BadRequestException('Cotação e IOF exigem uma moeda estrangeira informada');
    }
    if (dto.iofCents != null && dto.iofCents > amountCents) {
      throw new BadRequestException('O IOF não pode ser maior que o valor do lançamento');
    }
  }

  private assertCategory(direction: FinancialDirection, category: FinancialCategory): void {
    if (!isCategoryOfDirection(category, direction)) {
      throw new BadRequestException(
        direction === 'INCOME'
          ? 'Categoria inválida para uma receita'
          : 'Categoria inválida para uma despesa',
      );
    }
  }

  private async getRaw(organizationId: string, id: string) {
    const entry = await this.prisma.financialEntry.findFirst({ where: { id, organizationId } });
    if (!entry) throw new NotFoundException('Lançamento não encontrado');
    return entry;
  }

  /** `SELECT ... FOR UPDATE`: serializa operações concorrentes no mesmo lançamento. */
  private async lockEntry(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "financial_entries" WHERE id = ${id} FOR UPDATE`;
  }

  /**
   * Recalcula pago/status/quitação a partir dos pagamentos não estornados —
   * a ÚNICA função que escreve esses três campos (ver invariante no topo).
   */
  private async applyPaidState(tx: Prisma.TransactionClient, entryId: string): Promise<EntryWithRelations> {
    const entry = await tx.financialEntry.findUniqueOrThrow({ where: { id: entryId } });
    const totals = await tx.financialPayment.aggregate({
      where: { entryId, reversedAt: null },
      _sum: { amountCents: true },
      _max: { paidAt: true },
    });
    const paidCents = totals._sum.amountCents ?? 0;
    const status =
      entry.status === 'CANCELLED'
        ? 'CANCELLED'
        : statusFromPaid({ amountCents: entry.amountCents, paidCents }, entry.status === 'PLANNED' ? 'PLANNED' : 'PENDING');

    return tx.financialEntry.update({
      where: { id: entryId },
      data: {
        paidCents,
        status,
        settledAt: status === 'PAID' ? totals._max.paidAt : null,
      },
      include: ENTRY_INCLUDE,
    });
  }

  /**
   * Valida cliente/contrato na organização e aplica a regra "contrato implica
   * o cliente do contrato" — assim todo lançamento de um contrato aparece
   * também na rentabilidade do cliente.
   */
  async resolveLinks(
    organizationId: string,
    customerId?: string,
    contractId?: string,
  ): Promise<{ customerId: string | null; contractId: string | null }> {
    let resolvedCustomerId = customerId ?? null;

    if (contractId) {
      const contract = await this.prisma.contract.findFirst({
        where: { id: contractId, organizationId },
        select: { customerId: true },
      });
      if (!contract) throw new NotFoundException('Contrato não encontrado');
      if (resolvedCustomerId && resolvedCustomerId !== contract.customerId) {
        throw new BadRequestException('O contrato pertence a outro cliente');
      }
      resolvedCustomerId = contract.customerId;
    }

    if (resolvedCustomerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: resolvedCustomerId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) throw new NotFoundException('Cliente não encontrado');
    }

    return { customerId: resolvedCustomerId, contractId: contractId ?? null };
  }
}
