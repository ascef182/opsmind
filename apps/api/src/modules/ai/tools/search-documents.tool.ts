import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  EMBEDDING_GATEWAY,
  type EmbeddingGateway,
} from '../../documents/gateway/embedding-gateway.interface';
import type { AiTool, AiToolContext } from './ai-tool.interface';

export interface SearchDocumentsInput {
  query: string;
}

export interface DocumentSearchResult {
  documentId: string;
  filename: string;
  content: string;
  chunkIndex: number;
  similarity: number;
}

const MAX_RESULTS = 5;

/**
 * Cobre o cenário do critério de aceitação da Fase 4 (PRD §17): "perguntar
 * sobre o conteúdo de um contrato enviado retorna resposta correta citando
 * o trecho/documento de origem." O `content` retornado é sempre tratado
 * pelo AiService como um bloco de tool_result — dado delimitado, nunca
 * concatenado como instrução (PRD §11: proteção contra prompt injection via
 * conteúdo de documento).
 */
@Injectable()
export class SearchDocumentsTool implements AiTool<SearchDocumentsInput> {
  readonly name = 'search_documents';
  readonly description =
    'Busca trechos relevantes nos documentos (PDFs) do workspace por similaridade semântica, para responder perguntas citando a fonte (documento + trecho).';
  readonly inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A pergunta ou tema a buscar nos documentos.' },
    },
    required: ['query'],
    additionalProperties: false,
  };

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_GATEWAY) private readonly embeddingGateway: EmbeddingGateway,
  ) {}

  async execute(input: SearchDocumentsInput, context: AiToolContext): Promise<DocumentSearchResult[]> {
    const [queryEmbedding] = await this.embeddingGateway.embed([input.query]);
    const vectorLiteral = `[${queryEmbedding!.join(',')}]`;

    // Filtro explícito por organização mesmo com RLS ativa em document_chunks
    // (defesa em profundidade, mesmo padrão do resto das tools de IA) — nunca
    // confia só na policy do banco pra isolamento de tenant.
    return this.prisma.$queryRaw<DocumentSearchResult[]>`
      SELECT dc.document_id AS "documentId", d.filename, dc.content, dc.chunk_index AS "chunkIndex",
             1 - (dc.embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE dc.organization_id = ${context.organizationId}
      ORDER BY dc.embedding <=> ${vectorLiteral}::vector
      LIMIT ${MAX_RESULTS}
    `;
  }
}
