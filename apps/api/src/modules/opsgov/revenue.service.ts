import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@opsmind/database';
import {
  activeAt,
  addMonths,
  computeRbt12,
  fromDateKey,
  monthOf,
  monthRange,
  toDateKey,
  todayInSaoPaulo,
  type Rbt12Result,
} from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanceReportsService } from '../finance/finance-reports.service';
import type { ClassifyRevenueDto, Rbt12QueryDto, RevenueByActivityQueryDto, UnclassifiedQueryDto } from './dto/revenue.dto';
import { monthlyRevenue, revenueByActivity, type RevenueBasis, type RevenueByActivity } from './revenue-by-activity';
import type { OpsGovActor } from './opsgov.types';

const UNCLASSIFIED_LIMIT = 500;

export interface UnclassifiedEntry {
  id: string;
  description: string;
  customerName: string | null;
  amountCents: number;
  status: string;
  issueDate: string;
}

export interface Rbt12View extends Rbt12Result {
  basis: RevenueBasis;
  activityStartMonth: string | null;
}

/**
 * Receita por atividade. Só lançamentos BUSINESS/INCOME são classificáveis e
 * entram no faturamento; as somas de período vêm do financeiro
 * (`FinanceReportsService.businessIncomeDataset` + `monthlySeries`).
 */
@Injectable()
export class RevenueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly financeReports: FinanceReportsService,
  ) {}

  async listUnclassified(organizationId: string, query: UnclassifiedQueryDto): Promise<UnclassifiedEntry[]> {
    const issueDate =
      query.from || query.to
        ? { ...(query.from ? { gte: fromDateKey(query.from) } : {}), ...(query.to ? { lte: fromDateKey(query.to) } : {}) }
        : undefined;
    const rows = await this.prisma.financialEntry.findMany({
      where: {
        organizationId,
        direction: 'INCOME',
        scope: 'BUSINESS',
        companyActivityId: null,
        status: { not: 'CANCELLED' },
        ...(issueDate ? { issueDate } : {}),
      },
      select: {
        id: true,
        description: true,
        amountCents: true,
        status: true,
        issueDate: true,
        customer: { select: { name: true } },
      },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: UNCLASSIFIED_LIMIT,
    });
    return rows.map((r) => ({
      id: r.id,
      description: r.description,
      customerName: r.customer?.name ?? null,
      amountCents: r.amountCents,
      status: r.status,
      issueDate: toDateKey(r.issueDate),
    }));
  }

  /**
   * Classifica em lote. A pessoa escolhe o CNAE; cada lançamento é ligado à
   * versão desse CNAE vigente na sua data de emissão. Tudo ou nada: um
   * lançamento inelegível recusa o lote inteiro.
   */
  async classify(
    organizationId: string,
    dto: ClassifyRevenueDto,
    actor: OpsGovActor,
  ): Promise<{ classified: number }> {
    const entryIds = [...new Set(dto.entryIds)];

    const classified = await this.prisma.runInTransaction(async (tx) => {
      const entries = await tx.financialEntry.findMany({
        where: { id: { in: entryIds }, organizationId },
        select: { id: true, direction: true, scope: true, status: true, issueDate: true },
      });
      if (entries.length !== entryIds.length) throw new NotFoundException('Lançamento não encontrado');

      const ineligible = entries.filter((e) => e.direction !== 'INCOME' || e.scope !== 'BUSINESS' || e.status === 'CANCELLED');
      if (ineligible.length > 0) {
        throw new BadRequestException(
          'Só receitas da empresa não canceladas podem ser classificadas por atividade ' +
            `(${ineligible.length} lançamento(s) inelegível(is))`,
        );
      }

      if (dto.companyActivityId === null) {
        const result = await tx.financialEntry.updateMany({
          where: { id: { in: entryIds }, organizationId },
          data: { companyActivityId: null },
        });
        return result.count;
      }

      const chosen = await tx.companyActivity.findFirst({
        where: { id: dto.companyActivityId, organizationId },
        select: { cnae: true },
      });
      if (!chosen) throw new NotFoundException('Atividade não encontrada');
      const versions = (
        await tx.companyActivity.findMany({ where: { organizationId, cnae: chosen.cnae }, select: { id: true, validFrom: true, validTo: true } })
      ).map((v) => ({ id: v.id, validFrom: toDateKey(v.validFrom), validTo: v.validTo ? toDateKey(v.validTo) : null }));

      const byVersion = new Map<string, string[]>();
      const outside: string[] = [];
      for (const entry of entries) {
        const version = activeAt(versions, toDateKey(entry.issueDate));
        if (!version) outside.push(toDateKey(entry.issueDate));
        else byVersion.set(version.id, [...(byVersion.get(version.id) ?? []), entry.id]);
      }
      if (outside.length > 0) {
        throw new BadRequestException(
          `O CNAE ${chosen.cnae} não estava vigente na emissão de ${outside.length} lançamento(s) ` +
            `(${[...new Set(outside)].sort().slice(0, 5).join(', ')})`,
        );
      }

      let count = 0;
      for (const [companyActivityId, ids] of byVersion) {
        const result = await tx.financialEntry.updateMany({
          where: { id: { in: ids }, organizationId },
          data: { companyActivityId },
        });
        count += result.count;
      }
      return count;
    });

    await this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action: 'opsgov.revenue.classified',
      resource: 'FinancialEntry:batch',
      metadata: { companyActivityId: dto.companyActivityId, count: classified, entryIds } as Prisma.InputJsonValue,
    });
    return { classified };
  }

  async byActivity(organizationId: string, query: RevenueByActivityQueryDto): Promise<RevenueByActivity> {
    const toMonth = query.to ?? monthOf(todayInSaoPaulo());
    const fromMonth = query.from ?? addMonths(toMonth, -11);
    if (fromMonth > toMonth) throw new BadRequestException('O mês inicial não pode ser posterior ao final');
    if (addMonths(fromMonth, 36) <= toMonth) throw new BadRequestException('Período máximo de 36 meses');

    const [data, versions] = await Promise.all([
      this.financeReports.businessIncomeDataset(organizationId, monthRange(fromMonth).from, monthRange(toMonth).to),
      this.prisma.companyActivity.findMany({
        where: { organizationId },
        select: { id: true, cnae: true, description: true, revenueGroup: true, validFrom: true },
      }),
    ]);
    return revenueByActivity(
      data,
      versions.map((v) => ({ ...v, validFrom: toDateKey(v.validFrom) })),
      fromMonth,
      toMonth,
      query.basis ?? 'COMPETENCIA',
    );
  }

  async rbt12(organizationId: string, query: Rbt12QueryDto): Promise<Rbt12View> {
    const month = query.month ?? monthOf(todayInSaoPaulo());
    const basis = query.basis ?? 'COMPETENCIA';
    const fromMonth = addMonths(month, -12);

    const [data, activityStartMonth] = await Promise.all([
      this.financeReports.businessIncomeDataset(organizationId, monthRange(fromMonth).from, monthRange(month).to),
      this.activityStartMonth(organizationId),
    ]);
    const revenue = monthlyRevenue(data, fromMonth, month, basis);
    return { ...computeRbt12(revenue, month, activityStartMonth), basis, activityStartMonth };
  }

  // Início de atividade = primeiro cadastro registrado (ou, sem cadastro, a
  // primeira atividade). Sem nenhum dos dois, assume mais de 12 meses.
  private async activityStartMonth(organizationId: string): Promise<string | null> {
    const [registration, activity] = await Promise.all([
      this.prisma.companyRegistrationPeriod.findFirst({ where: { organizationId }, orderBy: { validFrom: 'asc' }, select: { validFrom: true } }),
      this.prisma.companyActivity.findFirst({ where: { organizationId }, orderBy: { validFrom: 'asc' }, select: { validFrom: true } }),
    ]);
    const first = registration?.validFrom ?? activity?.validFrom;
    return first ? monthOf(toDateKey(first)) : null;
  }
}
