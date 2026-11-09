import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SignalCodesService } from './signal-codes.service';

describe('SignalCodesService', () => {
  function buildDeps() {
    const prisma = {
      signalCode: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const auditService = { log: jest.fn() };
    const service = new SignalCodesService(prisma as never, auditService as never);
    return { service, prisma, auditService };
  }

  describe('list', () => {
    it('lista códigos globais (organizationId null) + os propostos por esta organização', async () => {
      const { service, prisma } = buildDeps();
      prisma.signalCode.findMany.mockResolvedValue([]);

      await service.list('org-1');

      expect(prisma.signalCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ organizationId: null }, { organizationId: 'org-1' }] },
        }),
      );
    });
  });

  describe('propose', () => {
    it('cria sempre como PROPOSED, escopado à organização, nunca global', async () => {
      const { service, prisma, auditService } = buildDeps();
      prisma.signalCode.findUnique.mockResolvedValue(null);
      prisma.signalCode.create.mockResolvedValue({ code: 'custom.novo_sinal', organizationId: 'org-1', status: 'PROPOSED' });

      const result = await service.propose(
        'org-1',
        { code: 'custom.novo_sinal', label: 'Novo sinal', category: 'custom' },
        'user-1',
      );

      expect(prisma.signalCode.create).toHaveBeenCalledWith({
        data: { code: 'custom.novo_sinal', organizationId: 'org-1', label: 'Novo sinal', category: 'custom', status: 'PROPOSED' },
      });
      expect(result.status).toBe('PROPOSED');
      expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'signal_code.propose' }));
    });

    it('rejeita propor um código que já existe (global ou de outra organização)', async () => {
      const { service, prisma } = buildDeps();
      prisma.signalCode.findUnique.mockResolvedValue({ code: 'website.no_ssl', status: 'CONFIRMED' });

      await expect(
        service.propose('org-1', { code: 'website.no_ssl', label: 'x', category: 'website' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.signalCode.create).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('promove PROPOSED -> CONFIRMED só quando o código pertence a esta organização', async () => {
      const { service, prisma, auditService } = buildDeps();
      prisma.signalCode.findFirst.mockResolvedValue({ code: 'custom.x', organizationId: 'org-1', status: 'PROPOSED' });
      prisma.signalCode.update.mockResolvedValue({ code: 'custom.x', status: 'CONFIRMED' });

      const result = await service.confirm('org-1', 'custom.x', 'user-1');

      expect(prisma.signalCode.findFirst).toHaveBeenCalledWith({ where: { code: 'custom.x', organizationId: 'org-1' } });
      expect(prisma.signalCode.update).toHaveBeenCalledWith({ where: { code: 'custom.x' }, data: { status: 'CONFIRMED' } });
      expect(result.status).toBe('CONFIRMED');
      expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'signal_code.confirm' }));
    });

    it('lança NotFoundException quando o código não pertence a esta organização (nunca confirma global de outro tenant)', async () => {
      const { service, prisma } = buildDeps();
      prisma.signalCode.findFirst.mockResolvedValue(null);

      await expect(service.confirm('org-1', 'website.no_ssl', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.signalCode.update).not.toHaveBeenCalled();
    });

    it('rejeita confirmar um código que não está em PROPOSED', async () => {
      const { service, prisma } = buildDeps();
      prisma.signalCode.findFirst.mockResolvedValue({ code: 'custom.x', organizationId: 'org-1', status: 'CONFIRMED' });

      await expect(service.confirm('org-1', 'custom.x', 'user-1')).rejects.toThrow(BadRequestException);
      expect(prisma.signalCode.update).not.toHaveBeenCalled();
    });
  });
});
