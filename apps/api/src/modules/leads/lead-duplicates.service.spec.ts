import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LeadDuplicatesService } from './lead-duplicates.service';

const pending = { id: 'cand-1', organizationId: 'org-1', leadAId: 'lead-a', leadBId: 'lead-b', status: 'PENDING' };

function build(candidate: Record<string, unknown> | null = pending, kept: Record<string, unknown> | null = { duplicateOfLeadId: null }) {
  const prisma = {
    leadDuplicateCandidate: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
        candidate && where.organizationId === candidate.organizationId ? candidate : null,
      ),
      update: jest.fn(async ({ data }: { data: object }) => ({ ...candidate, ...data })),
    },
    lead: { findFirst: jest.fn(async () => kept), updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const audit = { log: jest.fn() };
  return { prisma, audit, service: new LeadDuplicatesService(prisma as never, audit as never) };
}

describe('LeadDuplicatesService', () => {
  it('confirming only marks the chosen lead as duplicate of the other; nothing is merged or deleted', async () => {
    const { service, prisma } = build();
    await service.confirm('org-1', 'cand-1', 'lead-b', 'u1');
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-b', organizationId: 'org-1' },
      data: { duplicateOfLeadId: 'lead-a' },
    });
    expect(prisma.leadDuplicateCandidate.update).toHaveBeenCalledWith({
      where: { id: 'cand-1' },
      data: expect.objectContaining({ status: 'CONFIRMED', reviewedByUserId: 'u1' }),
    });
  });

  it('rejects a lead outside the pair', async () => {
    const { service } = build();
    await expect(service.confirm('org-1', 'cand-1', 'lead-z', 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to chain duplicates', async () => {
    const { service, prisma } = build(pending, { duplicateOfLeadId: 'lead-c' });
    await expect(service.confirm('org-1', 'cand-1', 'lead-b', 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
  });

  it('a reviewed pair cannot be reviewed again without reopening', async () => {
    const { service } = build({ ...pending, status: 'DISMISSED' });
    await expect(service.confirm('org-1', 'cand-1', 'lead-b', 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('reopening a confirmed pair unmarks the duplicate', async () => {
    const { service, prisma } = build({ ...pending, status: 'CONFIRMED' });
    await service.reopen('org-1', 'cand-1', 'u1');
    expect(prisma.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { duplicateOfLeadId: null } }),
    );
    expect(prisma.leadDuplicateCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PENDING', reviewedByUserId: null, reviewedAt: null } }),
    );
  });

  it('never touches a pair of another organization', async () => {
    const { service, prisma } = build();
    await expect(service.dismiss('org-2', 'cand-1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.leadDuplicateCandidate.update).not.toHaveBeenCalled();
  });
});
