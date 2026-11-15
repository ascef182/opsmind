import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InternalNotesService } from './internal-notes.service';

function buildDeps() {
  const prisma = {
    internalNote: { create: jest.fn(), findMany: jest.fn() },
    membership: { findMany: jest.fn() },
    // Default: deal/lead "existe nesta organização" — cada teste que
    // precisa do caminho contrário (cross-tenant/inexistente) sobrescreve.
    deal: { findFirst: jest.fn().mockResolvedValue({ id: 'deal-1' }) },
    lead: { findFirst: jest.fn().mockResolvedValue({ id: 'lead-1' }) },
  };
  const notificationsService = { create: jest.fn().mockResolvedValue(undefined) };

  const service = new InternalNotesService(prisma as never, notificationsService as never);

  return { service, prisma, notificationsService };
}

describe('InternalNotesService.createForDeal', () => {
  it('cria a nota vinculada ao deal (nunca ao lead)', async () => {
    const { service, prisma } = buildDeps();
    prisma.internalNote.create.mockResolvedValue({ id: 'note-1', dealId: 'deal-1', body: 'oi' });

    await service.createForDeal('org-1', 'deal-1', { body: 'oi' }, 'user-1');

    expect(prisma.internalNote.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        dealId: 'deal-1',
        body: 'oi',
        mentionedUserIds: [],
        authorUserId: 'user-1',
      },
    });
  });

  it('valida que todos os mencionados são membros da organização', async () => {
    const { service, prisma } = buildDeps();
    prisma.membership.findMany.mockResolvedValue([{ userId: 'user-a' }]);

    await expect(
      service.createForDeal('org-1', 'deal-1', { body: 'oi', mentionedUserIds: ['user-a', 'user-de-fora'] }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.internalNote.create).not.toHaveBeenCalled();
  });

  // Achado de security-review (2026-09-18): dealId/leadId vinha direto do
  // @Param() sem checar dono — RLS só valida internal_notes.organization_id
  // (a linha nova em si), nunca a organização do Deal/Lead referenciado.
  it('lança NotFoundException quando o deal não existe (ou é de outra organização) — nunca cria a nota', async () => {
    const { service, prisma } = buildDeps();
    prisma.deal.findFirst.mockResolvedValue(null);

    await expect(service.createForDeal('org-1', 'deal-de-outra-org', { body: 'oi' }, 'user-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.deal.findFirst).toHaveBeenCalledWith({
      where: { id: 'deal-de-outra-org', organizationId: 'org-1' },
      select: { id: true },
    });
    expect(prisma.internalNote.create).not.toHaveBeenCalled();
  });

  it('notifica cada mencionado (note.mention), exceto o próprio autor', async () => {
    const { service, prisma, notificationsService } = buildDeps();
    prisma.membership.findMany.mockResolvedValue([{ userId: 'user-a' }, { userId: 'user-1' }]);
    prisma.internalNote.create.mockResolvedValue({ id: 'note-1', dealId: 'deal-1', body: 'oi @user-a' });

    await service.createForDeal(
      'org-1',
      'deal-1',
      { body: 'oi @user-a', mentionedUserIds: ['user-a', 'user-1'] },
      'user-1',
    );

    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-a',
        type: 'note.mention',
        payload: expect.objectContaining({ noteId: 'note-1', dealId: 'deal-1' }),
      }),
    );
  });
});

describe('InternalNotesService.createForLead', () => {
  it('lança NotFoundException quando o lead não existe (ou é de outra organização) — nunca cria a nota', async () => {
    const { service, prisma } = buildDeps();
    prisma.lead.findFirst.mockResolvedValue(null);

    await expect(service.createForLead('org-1', 'lead-de-outra-org', { body: 'oi' }, 'user-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.lead.findFirst).toHaveBeenCalledWith({
      where: { id: 'lead-de-outra-org', organizationId: 'org-1' },
      select: { id: true },
    });
    expect(prisma.internalNote.create).not.toHaveBeenCalled();
  });

  it('cria a nota vinculada ao lead (nunca ao deal) e notifica com leadId no payload', async () => {
    const { service, prisma, notificationsService } = buildDeps();
    prisma.membership.findMany.mockResolvedValue([{ userId: 'user-a' }]);
    prisma.internalNote.create.mockResolvedValue({ id: 'note-1', leadId: 'lead-1', body: 'oi' });

    await service.createForLead('org-1', 'lead-1', { body: 'oi', mentionedUserIds: ['user-a'] }, 'user-1');

    expect(prisma.internalNote.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        leadId: 'lead-1',
        body: 'oi',
        mentionedUserIds: ['user-a'],
        authorUserId: 'user-1',
      },
    });
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ leadId: 'lead-1' }) }),
    );
  });
});

describe('InternalNotesService.listForDeal / listForLead', () => {
  it('lista notas de um deal, mais recentes primeiro', async () => {
    const { service, prisma } = buildDeps();
    prisma.internalNote.findMany.mockResolvedValue([{ id: 'note-1' }]);

    const result = await service.listForDeal('org-1', 'deal-1');

    expect(prisma.internalNote.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', dealId: 'deal-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual([{ id: 'note-1' }]);
  });

  it('lista notas de um lead, mais recentes primeiro', async () => {
    const { service, prisma } = buildDeps();
    prisma.internalNote.findMany.mockResolvedValue([{ id: 'note-1' }]);

    const result = await service.listForLead('org-1', 'lead-1');

    expect(prisma.internalNote.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', leadId: 'lead-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual([{ id: 'note-1' }]);
  });
});
