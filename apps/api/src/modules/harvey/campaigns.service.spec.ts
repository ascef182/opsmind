import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

const existing = {
  id: 'camp-1',
  organizationId: 'org-1',
  workStartMinute: 540,
  workEndMinute: 1080,
};

function build() {
  const prisma = {
    salesCampaign: {
      findFirst: jest.fn(async ({ where }: { where: { id?: string; organizationId: string } }) =>
        where.organizationId === 'org-1' && (!where.id || where.id === 'camp-1') ? existing : null,
      ),
      update: jest.fn(async ({ data }: { data: object }) => ({ ...existing, ...data })),
      create: jest.fn(async ({ data }: { data: object }) => ({ id: 'camp-2', ...data })),
    },
    organizationRevenueSettings: { findUnique: jest.fn() },
  };
  const audit = { log: jest.fn() };
  return { prisma, audit, service: new CampaignsService(prisma as never, audit as never) };
}

describe('CampaignsService', () => {
  it('rejects an invalid IANA timezone', async () => {
    const { service } = build();
    await expect(service.update('org-1', 'camp-1', { timezone: 'Mars/Base' }, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a window whose end is not after the start', async () => {
    const { service } = build();
    await expect(service.update('org-1', 'camp-1', { workEndMinute: 540 }, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects enabling a channel that is not connected', async () => {
    const { service } = build();
    await expect(
      service.update('org-1', 'camp-1', { enabledChannels: ['EMAIL', 'WHATSAPP'] }, 'u1'),
    ).rejects.toThrow('WHATSAPP');
  });

  it('never updates a campaign of another organization', async () => {
    const { service, prisma } = build();
    await expect(service.update('org-2', 'camp-1', { dailyResearchGoal: 5 }, 'u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.salesCampaign.update).not.toHaveBeenCalled();
  });

  it('update writes audit log harvey.campaign.updated', async () => {
    const { service, audit } = build();
    await service.update('org-1', 'camp-1', { dailyResearchGoal: 12 }, 'u1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'harvey.campaign.updated', organizationId: 'org-1', actorId: 'u1' }),
    );
  });

  it('getDefault creates the default campaign from the org country when missing', async () => {
    const { service, prisma } = build();
    prisma.salesCampaign.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.organizationRevenueSettings.findUnique.mockResolvedValue({ defaultOutreachCountry: 'BR' });
    await service.getDefault('org-1');
    expect(prisma.salesCampaign.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        name: 'Campanha padrão',
        country: 'BR',
        language: 'pt-BR',
        timezone: 'America/Sao_Paulo',
      },
    });
  });

  it('getDefault reactivates an archived default campaign instead of colliding on its name', async () => {
    const { service, prisma } = build();
    prisma.salesCampaign.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...existing, status: 'ARCHIVED' } as never);
    await service.getDefault('org-1');
    expect(prisma.salesCampaign.update).toHaveBeenCalledWith({ where: { id: 'camp-1' }, data: { status: 'ACTIVE' } });
    expect(prisma.salesCampaign.create).not.toHaveBeenCalled();
  });
});
