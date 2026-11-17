import { ForbiddenException } from '@nestjs/common';
import { RevenueSettingsService } from './revenue-settings.service';

function buildDeps(globalPause = false) {
  const prisma = {
    organizationRevenueSettings: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    outreachMessage: { count: jest.fn().mockResolvedValue(0) },
  };
  const configService = { get: jest.fn().mockReturnValue(globalPause) };
  const service = new RevenueSettingsService(prisma as never, configService as never);
  return { service, prisma, configService };
}

const unpaused = {
  organizationId: 'org-1',
  outreachPaused: false,
  outreachPausedReason: null,
  dailySendLimit: 20,
  dailyResearchLimit: 40,
  engineMonthlyBudgetUsd: 50,
  defaultOutreachCountry: 'US',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('RevenueSettingsService', () => {
  it('organização sem configuração gravada nasce com outreach PAUSADO, sem escrever nada no GET', async () => {
    const { service, prisma } = buildDeps();

    const settings = await service.get('org-1');

    expect(settings).toEqual(expect.objectContaining({ organizationId: 'org-1', outreachPaused: true }));
    expect(prisma.organizationRevenueSettings.upsert).not.toHaveBeenCalled();
  });

  it('despausar limpa o motivo da pausa anterior', async () => {
    const { service, prisma } = buildDeps();

    await service.update('org-1', { outreachPaused: false });

    expect(prisma.organizationRevenueSettings.upsert).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      create: { organizationId: 'org-1', outreachPaused: false, outreachPausedReason: null },
      update: { outreachPaused: false, outreachPausedReason: null },
    });
  });

  describe('assertCanSendOutreach', () => {
    it('bloqueia por padrão (organização nunca configurada)', async () => {
      const { service } = buildDeps();

      await expect(service.assertCanSendOutreach('org-1')).rejects.toThrow(ForbiddenException);
    });

    it('freio global da instância vence a configuração da organização', async () => {
      const { service, prisma } = buildDeps(true);
      prisma.organizationRevenueSettings.findUnique.mockResolvedValue(unpaused);

      await expect(service.assertCanSendOutreach('org-1')).rejects.toThrow(/OUTREACH_GLOBAL_PAUSE/);
    });

    it('bloqueia quando o teto diário de e-mails já foi atingido', async () => {
      const { service, prisma } = buildDeps();
      prisma.organizationRevenueSettings.findUnique.mockResolvedValue(unpaused);
      prisma.outreachMessage.count.mockResolvedValue(20);

      await expect(service.assertCanSendOutreach('org-1')).rejects.toThrow(/Limite diário de 20/);
      expect(prisma.outreachMessage.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', channel: 'EMAIL', sentAt: { gte: expect.any(Date) } },
      });
    });

    it('libera quando despausado e abaixo do teto', async () => {
      const { service, prisma } = buildDeps();
      prisma.organizationRevenueSettings.findUnique.mockResolvedValue(unpaused);
      prisma.outreachMessage.count.mockResolvedValue(19);

      await expect(service.assertCanSendOutreach('org-1')).resolves.toBeUndefined();
    });
  });
});
