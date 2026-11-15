import { randomUUID } from 'crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Document } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { STORAGE_SERVICE, type StorageService } from '../../infrastructure/storage/storage.interface';
import { EMBEDDING_GATEWAY, type EmbeddingGateway } from './gateway/embedding-gateway.interface';
import { extractPdfText } from './utils/extract-pdf-text';
import { chunkText } from './utils/chunk-text';

// PDF é o único tipo suportado na Fase 4 (PRD §17) — outros formatos ficam
// para depois, quando houver extração de texto equivalente pra eles.
const ALLOWED_MIME_TYPE = 'application/pdf';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface DownloadableFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Sem repository layer (Decisão #12 do blueprint da Fase 1, mantida aqui) —
 * chama `PrismaService` diretamente.
 *
 * `upload()` processa síncrono, dentro do próprio request (extração →
 * chunking → embeddings → persistência dos chunks) — a fila BullMQ
 * (`document-processing`, PRD §12) só chega na Fase 5; antecipar essa infra
 * aqui puxaria escopo de fase errada. Falhas de processamento (PDF
 * corrompido, provider de embeddings indisponível) nunca fazem o upload em
 * si falhar: o arquivo já foi aceito e guardado, então o Document termina
 * com status FAILED + errorMessage, visível via GET, em vez de um 500.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storageService: StorageService,
    @Inject(EMBEDDING_GATEWAY) private readonly embeddingGateway: EmbeddingGateway,
    private readonly auditService: AuditService,
  ) {}

  async upload(
    organizationId: string,
    actorUserId: string,
    file: UploadedFile,
    customerId: string | undefined,
  ): Promise<Document> {
    if (file.mimetype !== ALLOWED_MIME_TYPE) {
      throw new BadRequestException('Só arquivos PDF são aceitos nesta fase.');
    }
    if (customerId) {
      await this.assertCustomerInOrg(organizationId, customerId);
    }

    const storageKey = `organizations/${organizationId}/documents/${randomUUID()}-${file.originalname}`;
    await this.storageService.save(storageKey, file.buffer);

    const document = await this.prisma.document.create({
      data: {
        organizationId,
        customerId,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageUrl: storageKey,
        status: 'PROCESSING',
        uploadedByUserId: actorUserId,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'document.uploaded',
      resource: `Document:${document.id}`,
      metadata: { filename: file.originalname },
    });

    return this.processDocument(organizationId, document, file.buffer);
  }

  private async processDocument(
    organizationId: string,
    document: Document,
    fileBuffer: Buffer,
  ): Promise<Document> {
    try {
      const text = await extractPdfText(fileBuffer);
      const chunks = chunkText(text);

      if (chunks.length > 0) {
        const embeddings = await this.embeddingGateway.embed(chunks);
        await Promise.all(
          chunks.map((content, index) =>
            this.storeChunk({
              organizationId,
              documentId: document.id,
              chunkIndex: index,
              content,
              embedding: embeddings[index]!,
            }),
          ),
        );
      }

      return this.prisma.document.update({ where: { id: document.id }, data: { status: 'READY' } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      return this.prisma.document.update({
        where: { id: document.id },
        data: { status: 'FAILED', errorMessage },
      });
    }
  }

  /**
   * `embedding` é `Unsupported("vector(1536)")` no schema — Prisma não sabe
   * escrever nesta coluna via `create()`, então é sempre SQL cru. O literal
   * `[0.1,0.2,...]` vai como parâmetro de string e é convertido pelo próprio
   * Postgres via `::vector` — não é concatenação de SQL não-parametrizada.
   */
  private storeChunk(params: {
    organizationId: string;
    documentId: string;
    chunkIndex: number;
    content: string;
    embedding: number[];
  }): Promise<unknown> {
    const id = randomUUID();
    const vectorLiteral = `[${params.embedding.join(',')}]`;
    return this.prisma.$executeRaw`
      INSERT INTO document_chunks (id, organization_id, document_id, chunk_index, content, embedding, created_at)
      VALUES (${id}, ${params.organizationId}, ${params.documentId}, ${params.chunkIndex}, ${params.content}, ${vectorLiteral}::vector, now())
    `;
  }

  list(organizationId: string, customerId: string | undefined): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: { organizationId, deletedAt: null, ...(customerId ? { customerId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdOrThrow(organizationId: string, documentId: string): Promise<Document> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId, deletedAt: null },
    });
    if (!document) {
      throw new NotFoundException('Documento não encontrado');
    }
    return document;
  }

  async getFileForDownload(organizationId: string, documentId: string): Promise<DownloadableFile> {
    const document = await this.findByIdOrThrow(organizationId, documentId);
    const buffer = await this.storageService.read(document.storageUrl);
    return { buffer, filename: document.filename, mimeType: document.mimeType };
  }

  private async assertCustomerInOrg(organizationId: string, customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId, deletedAt: null },
    });
    if (!customer) {
      throw new NotFoundException('Cliente vinculado não encontrado');
    }
  }
}
