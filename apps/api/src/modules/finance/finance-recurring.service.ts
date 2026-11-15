import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { RecurringEntry } from '@opsmind/database';
import {
  dateForMonthDay,
  fromDateKey,
  isCategoryOfDirection,
  monthOf,
  monthsDueForRecurring,
  recurringIssueDate,
  todayInSaoPaulo,
  type FinancialCategory,
} from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateRecurringDto, UpdateRecurringDto } from './dto/recurring.dto';
import { FinanceEntriesService } from './finance-entries.service';
import { toRecurringView } from './finance.mappers';
import type { FinanceActor, RecurringView } from './finance.types';

export interface GenerateResult {
  created: number;
  templates: number;
  upToMonth: string;
}

/**
 * Moldes de lançamento recorrente (mensalidade, VPS, domínio...).
 *
 * O molde NUNCA movimenta dinheiro: ele só faz nascer lançamentos PENDING. O
 * sistema sabe que a conta vence, não sabe se alguém pagou — marcar como paga
 * automaticamente encheria o caixa de dinheiro que não existe.
 *
 * Idempotência é do BANCO: unique (recurring_entry_id, reference_month) +
 * `createMany({ skipDuplicates })`. Rodar a geração duas vezes (ou duas
 * execuções simultâneas) nunca duplica uma despesa.
 */
@Injectable()
export class FinanceRecurringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly entriesService: FinanceEntriesService,
  ) {}

  async list(organizationId: string): Promise<RecurringView[]> {
    const rows = await this.prisma.recurringEntry.findMany({
      where: { organizationId },
      orderBy: [{ active: 'desc' }, { description: 'asc' }],
    });
    return rows.map(toRecurringView);
  }

  async create(organizationId: string, dto: CreateRecurringDto, actor: FinanceActor): Promise<RecurringView> {
    if (!isCategoryOfDirection(dto.category, dto.direction)) {
      throw new BadRequestException('Categoria incompatível com a direção do lançamento');
    }
    const feesCents = dto.feesCents ?? 0;
    if (dto.direction === 'EXPENSE' && feesCents > 0) {
      throw new BadRequestException('Taxas se aplicam apenas a receitas');
    }
    if (feesCents > dto.amountCents) {
      throw new BadRequestException('As taxas não podem ser maiores que o valor');
    }
    if ((dto.foreignCurrency != null) !== (dto.foreignAmountCents != null)) {
      throw new BadRequestException('Moeda estrangeira e valor nominal precisam vir juntos');
    }
    const currentMonth = monthOf(todayInSaoPaulo());
    const startMonth = dto.startMonth ?? currentMonth;
    if (dto.endMonth && dto.endMonth < startMonth) {
      throw new BadRequestException('O mês final não pode ser anterior ao inicial');
    }
    if (dto.scope === 'PERSONAL' && dto.contractId) {
      throw new BadRequestException('Molde pessoal não pode estar vinculado a um contrato (contrato é sempre da empresa)');
    }
    const links = await this.entriesService.resolveLinks(organizationId, dto.customerId, dto.contractId);

    const template = await this.prisma.recurringEntry.create({
      data: {
        organizationId,
        direction: dto.direction,
        category: dto.category,
        scope: dto.scope ?? 'BUSINESS',
        description: dto.description.trim(),
        supplierName: dto.supplierName?.trim() || null,
        amountCents: dto.amountCents,
        feesCents,
        foreignCurrency: dto.foreignCurrency ?? null,
        foreignAmountCents: dto.foreignAmountCents ?? null,
        dayOfMonth: dto.dayOfMonth,
        startMonth,
        endMonth: dto.endMonth ?? null,
        customerId: links.customerId,
        contractId: links.contractId,
        actorType: actor.type,
        actorId: actor.id,
      },
    });

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'finance.recurring.created',
      resource: `RecurringEntry:${template.id}`,
      metadata: { direction: template.direction, amountCents: template.amountCents },
    });

    // Gera já o que está devido até o mês corrente (o primeiro lançamento não
    // deveria esperar o próximo ciclo do gerador).
    await this.generateFor(organizationId, [template], currentMonth, actor);
    return toRecurringView(template);
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateRecurringDto,
    actor: FinanceActor,
  ): Promise<RecurringView> {
    const current = await this.prisma.recurringEntry.findFirst({ where: { id, organizationId } });
    if (!current) throw new NotFoundException('Recorrência não encontrada');

    const amountCents = dto.amountCents ?? current.amountCents;
    const feesCents = dto.feesCents ?? current.feesCents;
    if (feesCents > amountCents) throw new BadRequestException('As taxas não podem ser maiores que o valor');
    if (current.direction === 'EXPENSE' && feesCents > 0) {
      throw new BadRequestException('Taxas se aplicam apenas a receitas');
    }
    const endMonth = dto.endMonth !== undefined ? dto.endMonth : current.endMonth;
    if (endMonth && endMonth < current.startMonth) {
      throw new BadRequestException('O mês final não pode ser anterior ao inicial');
    }
    const foreignCurrency = dto.foreignCurrency !== undefined ? dto.foreignCurrency : current.foreignCurrency;
    const foreignAmountCents = dto.foreignAmountCents !== undefined ? dto.foreignAmountCents : current.foreignAmountCents;
    if ((foreignCurrency != null) !== (foreignAmountCents != null)) {
      throw new BadRequestException('Moeda estrangeira e valor nominal precisam vir juntos');
    }

    // Lançamentos já gerados NÃO são tocados: mudar o aluguel em junho não
    // reescreve o que foi cobrado em maio. A mudança vale daqui para frente.
    const updated = await this.prisma.recurringEntry.update({
      where: { id },
      data: {
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.supplierName !== undefined ? { supplierName: dto.supplierName?.trim() || null } : {}),
        ...(dto.dayOfMonth !== undefined ? { dayOfMonth: dto.dayOfMonth } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        amountCents,
        feesCents,
        foreignCurrency,
        foreignAmountCents,
        endMonth,
      },
    });

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'finance.recurring.updated',
      resource: `RecurringEntry:${id}`,
      metadata: { changed: Object.keys(dto) },
    });
    return toRecurringView(updated);
  }

  /** Gera os lançamentos devidos de todos os moldes ativos da organização. */
  async generate(
    organizationId: string,
    upToMonth: string | undefined,
    actor: FinanceActor,
  ): Promise<GenerateResult> {
    const currentMonth = monthOf(todayInSaoPaulo());
    const target = upToMonth ?? currentMonth;
    if (target > currentMonth) {
      throw new ConflictException('Só é possível gerar até o mês corrente');
    }
    const templates = await this.prisma.recurringEntry.findMany({ where: { organizationId, active: true } });
    const created = await this.generateFor(organizationId, templates, target, actor);
    return { created, templates: templates.length, upToMonth: target };
  }

  private async generateFor(
    organizationId: string,
    templates: RecurringEntry[],
    upToMonth: string,
    actor: FinanceActor,
  ): Promise<number> {
    const today = todayInSaoPaulo();
    const rows = templates.flatMap((t) =>
      monthsDueForRecurring(t, upToMonth).map((month) => {
        const dueDate = dateForMonthDay(month, t.dayOfMonth);
        return {
          organizationId,
          direction: t.direction,
          category: t.category,
          scope: t.scope,
          description: t.description,
          supplierName: t.supplierName,
          customerId: t.customerId,
          contractId: t.contractId,
          recurringEntryId: t.id,
          referenceMonth: month,
          amountCents: t.amountCents,
          feesCents: t.feesCents,
          // Valor nominal herdado do molde — cotação/IOF reais deste mês
          // nascem em branco, preenchidos depois pelo usuário ao reconciliar.
          foreignCurrency: t.foreignCurrency,
          foreignAmountCents: t.foreignAmountCents,
          status: 'PENDING' as const,
          issueDate: fromDateKey(recurringIssueDate(dueDate, today)),
          dueDate: fromDateKey(dueDate),
          actorType: actor.type,
          actorId: actor.id,
        };
      }),
    );
    if (rows.length === 0) return 0;

    const result = await this.prisma.financialEntry.createMany({ data: rows, skipDuplicates: true });
    if (result.count > 0) {
      await this.auditService.log({
        actorType: actor.type,
        actorId: actor.id,
        organizationId,
        action: 'finance.recurring.generated',
        resource: 'RecurringEntry',
        metadata: { created: result.count, upToMonth },
      });
    }
    return result.count;
  }

  /** Atalho usado pelo contrato MONTHLY: cria o molde de receita e já gera o devido. */
  async createForContract(
    organizationId: string,
    contract: {
      id: string;
      customerId: string;
      title: string;
      category: FinancialCategory;
      valueCents: number;
      billingDay: number;
      firstMonth: string;
      endMonth: string | null;
    },
    actor: FinanceActor,
  ): Promise<RecurringView> {
    return this.create(
      organizationId,
      {
        direction: 'INCOME',
        category: contract.category,
        description: `${contract.title} — mensalidade`,
        amountCents: contract.valueCents,
        dayOfMonth: contract.billingDay,
        startMonth: contract.firstMonth,
        endMonth: contract.endMonth ?? undefined,
        customerId: contract.customerId,
        contractId: contract.id,
      },
      actor,
    );
  }
}
