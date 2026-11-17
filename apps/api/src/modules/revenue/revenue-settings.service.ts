import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OrganizationRevenueSettings, Prisma } from '@opsmind/database';
import type { Env } from '@opsmind/config/env/schema';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export type RevenueSettings = Omit<OrganizationRevenueSettings, 'createdAt' | 'updatedAt'>;

export type RevenueSettingsPatch = Partial<
  Pick<
    OrganizationRevenueSettings,
    | 'outreachPaused'
    | 'outreachPausedReason'
    | 'dailySendLimit'
    | 'dailyResearchLimit'
    | 'defaultOutreachCountry'
  >
> & { engineMonthlyBudgetUsd?: number };

// Espelha os defaults da migration: uma organização sem linha ainda se
// comporta exatamente como uma recém-criada (outreach pausado).
const DEFAULTS: Omit<RevenueSettings, 'organizationId'> = {
  outreachPaused: true,
  outreachPausedReason: null,
  dailySendLimit: 20,
  dailyResearchLimit: 40,
  engineMonthlyBudgetUsd: 50 as unknown as Prisma.Decimal,
  defaultOutreachCountry: 'US',
};

@Injectable()
export class RevenueSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  // Leitura nunca cria a linha: GET não deve escrever.
  async get(organizationId: string): Promise<RevenueSettings> {
    const row = await this.prisma.organizationRevenueSettings.findUnique({
      where: { organizationId },
      select: {
        organizationId: true,
        outreachPaused: true,
        outreachPausedReason: true,
        dailySendLimit: true,
        dailyResearchLimit: true,
        engineMonthlyBudgetUsd: true,
        defaultOutreachCountry: true,
      },
    });
    return row ?? { organizationId, ...DEFAULTS };
  }

  async update(organizationId: string, patch: RevenueSettingsPatch): Promise<RevenueSettings> {
    const data = {
      ...patch,
      // Ao despausar, o motivo antigo deixa de valer.
      ...(patch.outreachPaused === false ? { outreachPausedReason: null } : {}),
    };
    await this.prisma.organizationRevenueSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    return this.get(organizationId);
  }

  /**
   * Portão de todo envio real de outreach. Ordem: freio de infraestrutura
   * (env), pausa da organização, teto diário de envios. Lança 403 com o
   * motivo; nunca envia "só desta vez".
   */
  async assertCanSendOutreach(organizationId: string): Promise<void> {
    if (this.configService.get('OUTREACH_GLOBAL_PAUSE', { infer: true })) {
      throw new ForbiddenException('Envio de outreach pausado globalmente nesta instância (OUTREACH_GLOBAL_PAUSE).');
    }
    const settings = await this.get(organizationId);
    if (settings.outreachPaused) {
      throw new ForbiddenException(
        `Envio de outreach pausado nesta organização${settings.outreachPausedReason ? `: ${settings.outreachPausedReason}` : ''}. Libere em Revenue Engine > Configurações.`,
      );
    }
    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);
    const sentToday = await this.prisma.outreachMessage.count({
      where: { organizationId, channel: 'EMAIL', sentAt: { gte: startOfDayUtc } },
    });
    if (sentToday >= settings.dailySendLimit) {
      throw new ForbiddenException(
        `Limite diário de ${settings.dailySendLimit} e-mails de outreach atingido nesta organização.`,
      );
    }
  }
}
