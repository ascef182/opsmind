import { BadRequestException, NotFoundException } from '@nestjs/common';

jest.mock('./utils/extract-pdf-text');
import { extractPdfText } from './utils/extract-pdf-text';
import { DocumentsService } from './documents.service';

const mockExtractPdfText = extractPdfText as jest.Mock;

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: {
    document: { create: jest.Mock; update: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
    customer: { findFirst: jest.Mock };
    $executeRaw: jest.Mock;
  };
  let storageService: { save: jest.Mock; read: jest.Mock };
  let embeddingGateway: { embed: jest.Mock };
  let auditService: { log: jest.Mock };

  const file = {
    originalname: 'contrato.pdf',
    mimetype: 'application/pdf',
    size: 1234,
    buffer: Buffer.from('%PDF-1.4 conteúdo fake'),
  };

  beforeEach(() => {
    mockExtractPdfText.mockReset();
    prisma = {
      document: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
      customer: { findFirst: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    storageService = { save: jest.fn(), read: jest.fn() };
    embeddingGateway = { embed: jest.fn() };
    auditService = { log: jest.fn() };

    service = new DocumentsService(
      prisma as never,
      storageService as never,
      embeddingGateway as never,
      auditService as never,
    );
  });

  describe('upload', () => {
    it('rejeita upload de arquivo que não é PDF, sem tocar em storage nem no banco', async () => {
      await expect(
        service.upload('org-1', 'user-1', { ...file, mimetype: 'text/plain' }, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(storageService.save).not.toHaveBeenCalled();
      expect(prisma.document.create).not.toHaveBeenCalled();
    });

    it('extrai, chunka e embeda o PDF, persiste os chunks e termina com status READY', async () => {
      storageService.save.mockResolvedValue('organizations/org-1/documents/uuid-contrato.pdf');
      prisma.document.create.mockResolvedValue({
        id: 'doc-1',
        organizationId: 'org-1',
        status: 'PROCESSING',
      });
      mockExtractPdfText.mockResolvedValue('Cláusula única: rescisão em 30 dias.');
      embeddingGateway.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
      prisma.document.update.mockResolvedValue({ id: 'doc-1', status: 'READY' });

      const result = await service.upload('org-1', 'user-1', file, undefined);

      expect(storageService.save).toHaveBeenCalledWith(
        expect.stringContaining('organizations/org-1/documents/'),
        file.buffer,
      );
      expect(prisma.document.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          filename: 'contrato.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1234,
          uploadedByUserId: 'user-1',
          status: 'PROCESSING',
          storageUrl: expect.stringContaining('organizations/org-1/documents/'),
        }),
      });
      expect(embeddingGateway.embed).toHaveBeenCalledWith(['Cláusula única: rescisão em 30 dias.']);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { status: 'READY' },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'USER', actorId: 'user-1', action: 'document.uploaded' }),
      );
      expect(result.status).toBe('READY');
    });

    it('lança 404 se um customerId for informado e não pertencer à organização', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(service.upload('org-1', 'user-1', file, 'cust-de-outra-org')).rejects.toThrow(
        NotFoundException,
      );
      expect(storageService.save).not.toHaveBeenCalled();
    });

    it('marca o documento como FAILED (sem lançar) quando a extração de texto falha', async () => {
      storageService.save.mockResolvedValue('organizations/org-1/documents/uuid-contrato.pdf');
      prisma.document.create.mockResolvedValue({ id: 'doc-1', organizationId: 'org-1', status: 'PROCESSING' });
      mockExtractPdfText.mockRejectedValue(new Error('PDF corrompido'));
      prisma.document.update.mockResolvedValue({
        id: 'doc-1',
        status: 'FAILED',
        errorMessage: 'PDF corrompido',
      });

      const result = await service.upload('org-1', 'user-1', file, undefined);

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { status: 'FAILED', errorMessage: 'PDF corrompido' },
      });
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(result.status).toBe('FAILED');
    });

    it('marca o documento como FAILED quando o provider de embeddings falha (ex.: sem OPENAI_API_KEY)', async () => {
      storageService.save.mockResolvedValue('organizations/org-1/documents/uuid-contrato.pdf');
      prisma.document.create.mockResolvedValue({ id: 'doc-1', organizationId: 'org-1', status: 'PROCESSING' });
      mockExtractPdfText.mockResolvedValue('Algum texto.');
      embeddingGateway.embed.mockRejectedValue(new Error('OPENAI_API_KEY ausente'));
      prisma.document.update.mockResolvedValue({ id: 'doc-1', status: 'FAILED' });

      await service.upload('org-1', 'user-1', file, undefined);

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { status: 'FAILED', errorMessage: 'OPENAI_API_KEY ausente' },
      });
    });
  });

  describe('list', () => {
    it('lista documentos não excluídos da organização', async () => {
      const documents = [{ id: 'doc-1' }];
      prisma.document.findMany.mockResolvedValue(documents);

      const result = await service.list('org-1', undefined);

      expect(prisma.document.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(documents);
    });
  });

  describe('findByIdOrThrow', () => {
    it('lança 404 quando o documento não existe, é de outra org, ou foi excluído', async () => {
      prisma.document.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('org-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFileForDownload', () => {
    it('busca o documento e lê o arquivo pelo storageUrl', async () => {
      prisma.document.findFirst.mockResolvedValue({
        id: 'doc-1',
        organizationId: 'org-1',
        filename: 'contrato.pdf',
        mimeType: 'application/pdf',
        storageUrl: 'organizations/org-1/documents/uuid-contrato.pdf',
      });
      const buffer = Buffer.from('bytes');
      storageService.read.mockResolvedValue(buffer);

      const result = await service.getFileForDownload('org-1', 'doc-1');

      expect(storageService.read).toHaveBeenCalledWith('organizations/org-1/documents/uuid-contrato.pdf');
      expect(result).toEqual({ buffer, filename: 'contrato.pdf', mimeType: 'application/pdf' });
    });
  });
});
