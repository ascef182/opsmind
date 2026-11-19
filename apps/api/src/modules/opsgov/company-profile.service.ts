import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CompanyActivity, Prisma } from '@opsmind/database';
import {
  PERIOD_CHANGE_REJECTION_MESSAGES,
  activeAt,
  fromDateKey,
  isActiveAt,
  normalizeCnae,
  normalizeCnpj,
  periodsOverlap,
  planPeriodChange,
  toDateKey,
  todayInSaoPaulo,
  type ValidityPeriod,
} from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertDocumentOfOrganization } from './assert-document';
import type {
  AddActivityDto,
  ChangeActivityDto,
  ChangeRegimeDto,
  ChangeRegistrationDto,
  EndActivityDto,
  UpsertCompanyProfileDto,
} from './dto/company-profile.dto';
import { toActivityView, toProfileView, toRegimeView, toRegistrationView } from './opsgov.mappers';
import type {
  CompanyActivityView,
  CompanyOverview,
  CompanyProfileView,
  CompanySnapshot,
  OpsGovActor,
  RegistrationPeriodView,
  TaxRegimePeriodView,
} from './opsgov.types';

type Tx = Prisma.TransactionClient;
type PeriodTable = 'registration' | 'regime' | 'activity';

type AsPeriod<T> = Omit<T, 'validFrom' | 'validTo'> & ValidityPeriod;

function asPeriod<T extends { validFrom: Date; validTo: Date | null }>(row: T): AsPeriod<T> {
  return { ...row, validFrom: toDateKey(row.validFrom), validTo: row.validTo ? toDateKey(row.validTo) : null };
}

// EXCLUDE USING gist barrou a sobreposição (corrida que passou pelo lock ou
// escrita fora do service): vira 409 legível.
function isOverlapViolation(error: unknown): boolean {
  return error instanceof Error && /_no_overlap|23P01|one_open_primary/.test(error.message);
}

/**
 * Estrutura da empresa com histórico. Cadastro (natureza + CNPJ), regime e
 * CNAEs nunca são editados no lugar: toda mudança fecha o registro vigente na
 * data em que o novo começa e abre o novo, na mesma transação, serializada por
 * advisory lock por organização+tabela. A regra de vigência é a função pura
 * `planPeriodChange`; o banco garante a ausência de sobreposição.
 */
@Injectable()
export class CompanyProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async overview(organizationId: string): Promise<CompanyOverview> {
    const [profile, registrations, regimes, activities] = await Promise.all([
      this.prisma.companyProfile.findUnique({ where: { organizationId } }),
      this.prisma.companyRegistrationPeriod.findMany({ where: { organizationId }, orderBy: { validFrom: 'desc' } }),
      this.prisma.taxRegimePeriod.findMany({ where: { organizationId }, orderBy: { validFrom: 'desc' } }),
      this.prisma.companyActivity.findMany({
        where: { organizationId },
        orderBy: [{ validTo: { sort: 'desc', nulls: 'first' } }, { isPrimary: 'desc' }, { cnae: 'asc' }],
      }),
    ]);
    return {
      profile: profile ? toProfileView(profile) : null,
      registrationPeriods: registrations.map(toRegistrationView),
      taxRegimePeriods: regimes.map(toRegimeView),
      activities: activities.map(toActivityView),
    };
  }

  async snapshotAt(organizationId: string, date: string = todayInSaoPaulo()): Promise<CompanySnapshot> {
    const { registrationPeriods, taxRegimePeriods, activities } = await this.overview(organizationId);
    return {
      date,
      registration: activeAt(registrationPeriods, date),
      regime: activeAt(taxRegimePeriods, date),
      activities: activities.filter((a) => isActiveAt(a, date)),
    };
  }

  async upsertProfile(
    organizationId: string,
    dto: UpsertCompanyProfileDto,
    actor: OpsGovActor,
  ): Promise<CompanyProfileView> {
    const data = {
      razaoSocial: dto.razaoSocial.trim(),
      nomeFantasia: dto.nomeFantasia?.trim() || null,
      enderecoFiscal: dto.enderecoFiscal?.trim() || null,
      municipio: dto.municipio?.trim() || null,
      uf: dto.uf?.toUpperCase() ?? null,
      inscricaoMunicipal: dto.inscricaoMunicipal?.trim() || null,
      inscricaoEstadual: dto.inscricaoEstadual?.trim() || null,
      actorType: actor.type,
      actorId: actor.id,
    };
    const profile = await this.prisma.companyProfile.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    await this.audit(organizationId, actor, 'opsgov.profile.updated', `CompanyProfile:${profile.id}`, {});
    return toProfileView(profile);
  }

  async changeRegistration(
    organizationId: string,
    dto: ChangeRegistrationDto,
    actor: OpsGovActor,
  ): Promise<RegistrationPeriodView> {
    const cnpj = normalizeCnpj(dto.cnpj);
    if (!cnpj) throw new BadRequestException('CNPJ inválido');
    await this.assertDocument(organizationId, dto.documentId);

    const created = await this.inPeriodTransaction(organizationId, 'registration', async (tx) => {
      const existing = await tx.companyRegistrationPeriod.findMany({ where: { organizationId } });
      const close = this.plan(existing.map(asPeriod), dto.validFrom);
      if (close) {
        await tx.companyRegistrationPeriod.update({
          where: { id: close.period.id },
          data: { validTo: fromDateKey(close.validTo) },
        });
      }
      const row = await tx.companyRegistrationPeriod.create({
        data: {
          organizationId,
          naturezaJuridica: dto.naturezaJuridica,
          cnpj,
          validFrom: fromDateKey(dto.validFrom),
          notes: dto.notes ?? null,
          documentId: dto.documentId ?? null,
          actorType: actor.type,
          actorId: actor.id,
        },
      });
      await tx.companyProfile.updateMany({ where: { organizationId }, data: { cnpj } });
      return { row, closedId: close?.period.id ?? null };
    });

    await this.audit(organizationId, actor, 'opsgov.registration.changed', `CompanyRegistrationPeriod:${created.row.id}`, {
      naturezaJuridica: created.row.naturezaJuridica,
      validFrom: dto.validFrom,
      closedPeriodId: created.closedId,
    });
    return toRegistrationView(created.row);
  }

  async changeRegime(organizationId: string, dto: ChangeRegimeDto, actor: OpsGovActor): Promise<TaxRegimePeriodView> {
    if (dto.regime === 'SIMEI' && dto.ibsCbsMode === 'REGULAR') {
      throw new BadRequestException('No SIMEI, IBS/CBS não é apurado pelo regime regular');
    }
    await this.assertDocument(organizationId, dto.documentId);

    const created = await this.inPeriodTransaction(organizationId, 'regime', async (tx) => {
      const existing = await tx.taxRegimePeriod.findMany({ where: { organizationId } });
      const close = this.plan(existing.map(asPeriod), dto.validFrom);
      if (close) {
        await tx.taxRegimePeriod.update({ where: { id: close.period.id }, data: { validTo: fromDateKey(close.validTo) } });
      }
      const row = await tx.taxRegimePeriod.create({
        data: {
          organizationId,
          regime: dto.regime,
          ibsCbsMode: dto.ibsCbsMode,
          validFrom: fromDateKey(dto.validFrom),
          notes: dto.notes ?? null,
          documentId: dto.documentId ?? null,
          actorType: actor.type,
          actorId: actor.id,
        },
      });
      return { row, closedId: close?.period.id ?? null };
    });

    await this.audit(organizationId, actor, 'opsgov.regime.changed', `TaxRegimePeriod:${created.row.id}`, {
      regime: created.row.regime,
      ibsCbsMode: created.row.ibsCbsMode,
      validFrom: dto.validFrom,
      closedPeriodId: created.closedId,
    });
    return toRegimeView(created.row);
  }

  async addActivity(organizationId: string, dto: AddActivityDto, actor: OpsGovActor): Promise<CompanyActivityView> {
    const cnae = normalizeCnae(dto.cnae);
    if (!cnae) throw new BadRequestException('CNAE inválido (formato 0000-0/00)');
    await this.assertDocument(organizationId, dto.documentId);

    const row = await this.inPeriodTransaction(organizationId, 'activity', async (tx) => {
      const all = (await tx.companyActivity.findMany({ where: { organizationId } })).map(asPeriod);
      const next: ValidityPeriod = { validFrom: dto.validFrom, validTo: null };
      if (all.some((a) => a.cnae === cnae && periodsOverlap(a, next))) {
        throw new ConflictException('Este CNAE já tem vigência nesse período — use a alteração de atividade');
      }
      if (dto.isPrimary) this.assertNoOtherPrimary(all, next);
      return tx.companyActivity.create({
        data: {
          organizationId,
          cnae,
          description: dto.description.trim(),
          isPrimary: dto.isPrimary ?? false,
          anexoSimples: dto.anexoSimples ?? 'NAO_DEFINIDO',
          revenueGroup: dto.revenueGroup ?? 'OUTROS',
          validFrom: fromDateKey(dto.validFrom),
          notes: dto.notes ?? null,
          documentId: dto.documentId ?? null,
          actorType: actor.type,
          actorId: actor.id,
        },
      });
    });

    await this.audit(organizationId, actor, 'opsgov.activity.added', `CompanyActivity:${row.id}`, { cnae, validFrom: dto.validFrom });
    return toActivityView(row);
  }

  async changeActivity(
    organizationId: string,
    activityId: string,
    dto: ChangeActivityDto,
    actor: OpsGovActor,
  ): Promise<CompanyActivityView> {
    await this.assertDocument(organizationId, dto.documentId);

    const row = await this.inPeriodTransaction(organizationId, 'activity', async (tx) => {
      const all = (await tx.companyActivity.findMany({ where: { organizationId } })).map(asPeriod);
      const current = all.find((a) => a.id === activityId);
      if (!current) throw new NotFoundException('Atividade não encontrada');
      if (current.validTo !== null) throw new ConflictException('Só a versão vigente de uma atividade pode ser alterada');

      const sameCnae = all.filter((a) => a.cnae === current.cnae);
      const close = this.plan(sameCnae, dto.validFrom);
      if (!close) throw new ConflictException('Atividade sem versão vigente');
      const isPrimary = dto.isPrimary ?? current.isPrimary;
      if (isPrimary) {
        this.assertNoOtherPrimary(
          all.filter((a) => a.id !== current.id),
          { validFrom: dto.validFrom, validTo: null },
        );
      }

      await tx.companyActivity.update({ where: { id: current.id }, data: { validTo: fromDateKey(close.validTo) } });
      return tx.companyActivity.create({
        data: {
          organizationId,
          cnae: current.cnae,
          description: dto.description?.trim() ?? current.description,
          isPrimary,
          anexoSimples: dto.anexoSimples ?? current.anexoSimples,
          revenueGroup: dto.revenueGroup ?? current.revenueGroup,
          validFrom: fromDateKey(dto.validFrom),
          notes: dto.notes ?? null,
          documentId: dto.documentId ?? null,
          actorType: actor.type,
          actorId: actor.id,
        },
      });
    });

    await this.audit(organizationId, actor, 'opsgov.activity.changed', `CompanyActivity:${row.id}`, {
      previousId: activityId,
      validFrom: dto.validFrom,
    });
    return toActivityView(row);
  }

  async endActivity(
    organizationId: string,
    activityId: string,
    dto: EndActivityDto,
    actor: OpsGovActor,
  ): Promise<CompanyActivityView> {
    const row = await this.inPeriodTransaction(organizationId, 'activity', async (tx) => {
      const current = await tx.companyActivity.findFirst({ where: { id: activityId, organizationId } });
      if (!current) throw new NotFoundException('Atividade não encontrada');
      if (current.validTo !== null) throw new ConflictException('Esta atividade já está encerrada');
      if (dto.validTo <= toDateKey(current.validFrom)) {
        throw new BadRequestException('O encerramento precisa ser posterior ao início da vigência');
      }
      return tx.companyActivity.update({
        where: { id: current.id },
        data: { validTo: fromDateKey(dto.validTo), notes: dto.notes ?? current.notes },
      });
    });

    await this.audit(organizationId, actor, 'opsgov.activity.ended', `CompanyActivity:${row.id}`, { validTo: dto.validTo });
    return toActivityView(row);
  }

  private plan<T extends ValidityPeriod>(existing: T[], validFrom: string) {
    const result = planPeriodChange(existing, { validFrom, validTo: null });
    if (!result.ok) throw new ConflictException(PERIOD_CHANGE_REJECTION_MESSAGES[result.reason]);
    return result.close;
  }

  private assertNoOtherPrimary(activities: Array<AsPeriod<CompanyActivity>>, next: ValidityPeriod): void {
    if (activities.some((a) => a.isPrimary && periodsOverlap(a, next))) {
      throw new ConflictException('Já existe uma atividade principal nesse período — encerre ou altere a atual antes');
    }
  }

  private async inPeriodTransaction<T>(organizationId: string, table: PeriodTable, fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.runInTransaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`opsgov:${table}:${organizationId}`}))`;
        return fn(tx);
      });
    } catch (error) {
      if (isOverlapViolation(error)) {
        throw new ConflictException('A vigência se sobrepõe a um período já registrado');
      }
      throw error;
    }
  }

  private assertDocument(organizationId: string, documentId: string | undefined): Promise<void> {
    return assertDocumentOfOrganization(this.prisma, organizationId, documentId);
  }

  private audit(
    organizationId: string,
    actor: OpsGovActor,
    action: string,
    resource: string,
    metadata: Record<string, unknown>,
  ) {
    return this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action,
      resource,
      metadata: metadata as Prisma.InputJsonValue,
    });
  }
}
