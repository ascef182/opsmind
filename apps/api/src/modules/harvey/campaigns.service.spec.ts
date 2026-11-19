import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

const existing = {
  id: 'camp-1',
  organizationId: 'org-1',
  kind: 'STANDARD',
  status: 'ACTIVE',
  name: 'Metalúrgica — Presidente Prudente/SP',
  segment: 'Metalúrgica',
  city: 'Presidente Prudente',
  state: 'SP',
  identityKey: 'metalurgica|presidente prudente|sp',
  timezone: 'America/Sao_Paulo',
  country: 'BR',
  workStartMinute: 540,
  workEndMinute: 1080,
};

type Where = Record<string, unknown> & { id?: string; organizationId: string };

function build(campaigns: Array<Record<string, unknown>> = [existing]) {
  const matches = (row: Record<string, unknown>, where: Where) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && 'in' in (value as object)) return (value as { in: unknown[] }).in.includes(row[key]);
      if (value && typeof value === 'object' && 'not' in (value as object)) return row[key] !== (value as { not: unknown }).not;
      if (value && typeof value === 'object') return true;
      return row[key] === value;
    });
  const prisma = {
    salesCampaign: {
      findFirst: jest.fn(async ({ where }: { where: Where }) => campaigns.find((row) => matches(row, where)) ?? null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async ({ data }: { data: object }) => ({ ...existing, ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      create: jest.fn(async ({ data }: { data: object }) => ({ id: 'camp-new', ...data })),
    },
    prospectingTarget: { create: jest.fn() },
    harveyRun: { updateMany: jest.fn(async () => ({ count: 1 })) },
    organizationRevenueSettings: { findUnique: jest.fn(async () => null) },
  };
  const audit = { log: jest.fn() };
  return { prisma, audit, service: new CampaignsService(prisma as never, audit as never) };
}

describe('CampaignsService', () => {
  it('rejects an invalid IANA timezone', async () => {
    const { service } = build();
    await expect(service.update('org-1', 'camp-1', { timezone: 'Mars/Base' }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a window whose end is not after the start', async () => {
    const { service } = build();
    await expect(service.update('org-1', 'camp-1', { workEndMinute: 540 }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects enabling a channel that is not connected', async () => {
    const { service } = build();
    await expect(service.update('org-1', 'camp-1', { enabledChannels: ['EMAIL', 'WHATSAPP'] }, 'u1')).rejects.toThrow('WHATSAPP');
  });

  it('never updates a campaign of another organization', async () => {
    const { service, prisma } = build();
    await expect(service.update('org-2', 'camp-1', { dailyResearchGoal: 5 }, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.salesCampaign.update).not.toHaveBeenCalled();
  });

  describe('findOrCreateForSearch', () => {
    it('reuses the live campaign with the same identity, ignoring case/accents, without touching its config', async () => {
      const { service, prisma } = build();
      const campaign = await service.findOrCreateForSearch('org-1', {
        businessType: 'metalurgica',
        city: 'presidente prudente',
        state: 'São Paulo',
      });
      expect(campaign.id).toBe('camp-1');
      expect(prisma.salesCampaign.create).not.toHaveBeenCalled();
      expect(prisma.salesCampaign.update).not.toHaveBeenCalled();
    });

    it('refuses to reuse a completed campaign silently', async () => {
      const { service } = build([{ ...existing, status: 'COMPLETED' }]);
      await expect(
        service.findOrCreateForSearch('org-1', { businessType: 'Metalúrgica', city: 'Presidente Prudente', state: 'SP' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates an AUTO_FROM_SEARCH campaign with Brazilian defaults for a Brazilian state', async () => {
      const { service, prisma } = build([]);
      await service.findOrCreateForSearch('org-1', { businessType: 'Padaria', city: 'Santos', state: 'SP' });
      expect(prisma.salesCampaign.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: 'STANDARD',
          creationSource: 'AUTO_FROM_SEARCH',
          name: 'Padaria — Santos/SP',
          identityKey: 'padaria|santos|sp',
          country: 'BR',
          timezone: 'America/Sao_Paulo',
        }),
      });
    });
  });

  it('create refuses a second live campaign for the same segment, city and state', async () => {
    const { service, prisma } = build();
    await expect(
      service.create('org-1', { segment: 'Metalúrgica', city: 'Presidente Prudente', state: 'SP' }, 'u1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.salesCampaign.create).not.toHaveBeenCalled();
  });

  it('create writes the campaign and one target per source', async () => {
    const { service, prisma, audit } = build([]);
    await service.create('org-1', { segment: 'Padaria', city: 'Santos', state: 'SP', sources: ['APIFY_GOOGLE_MAPS'] }, 'u1');
    expect(prisma.salesCampaign.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ creationSource: 'USER', segment: 'Padaria', city: 'Santos', state: 'SP' }),
    });
    expect(prisma.prospectingTarget.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ campaignId: 'camp-new', businessType: 'Padaria', sourceType: 'APIFY_GOOGLE_MAPS' }),
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'campaign.created' }));
  });

  describe('changeStatus', () => {
    it('pausing closes the open cycle so Harvey stops working on it', async () => {
      const { service, prisma } = build();
      await service.changeStatus('org-1', 'camp-1', 'pause', 'u1');
      expect(prisma.salesCampaign.updateMany).toHaveBeenCalledWith({
        where: { id: 'camp-1', organizationId: 'org-1', status: 'ACTIVE' },
        data: { status: 'PAUSED' },
      });
      expect(prisma.harveyRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'STOPPED', endReason: 'CAMPAIGN_PAUSED' }) }),
      );
    });

    it('rejects a transition not allowed from the current status', async () => {
      const { service } = build([{ ...existing, status: 'ARCHIVED' }]);
      await expect(service.changeStatus('org-1', 'camp-1', 'resume', 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('a concurrent change is reported instead of applied twice', async () => {
      const { service, prisma } = build();
      prisma.salesCampaign.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.changeStatus('org-1', 'camp-1', 'complete', 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.harveyRun.updateMany).not.toHaveBeenCalled();
    });

    it('legacy and manual-entry campaigns never change status', async () => {
      const { service } = build([{ ...existing, kind: 'LEGACY', status: 'COMPLETED' }]);
      await expect(service.changeStatus('org-1', 'camp-1', 'reopen', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('a target must share the campaign segment, city and state', () => {
    const { service } = build();
    expect(() =>
      service.assertTargetMatchesCampaign(existing as never, { businessType: 'Padaria', city: 'Presidente Prudente', state: 'SP' }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.assertTargetMatchesCampaign(existing as never, { businessType: 'metalúrgica', city: 'Presidente Prudente', state: 'SP' }),
    ).not.toThrow();
  });
});
