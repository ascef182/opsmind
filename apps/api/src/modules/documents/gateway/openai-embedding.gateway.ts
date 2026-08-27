import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { Env } from '@opsmind/config/env/schema';
import type { EmbeddingGateway } from './embedding-gateway.interface';

// 1536 dimensões — precisa bater exatamente com o `vector(1536)` da coluna
// embedding em document_chunks (migration 20260827210000_documents_rag).
// Trocar de modelo exige nova migration (dimensão diferente) + reprocessar
// documentos já indexados, não é uma troca "de graça".
const MODEL = 'text-embedding-3-small';

/**
 * Client construído sob demanda, igual ClaudeGatewayService (Fase 3):
 * OPENAI_API_KEY é opcional no schema de env, então a falta dela só falha
 * no primeiro upload de documento, não no boot da API inteira.
 */
@Injectable()
export class OpenAiEmbeddingGateway implements EmbeddingGateway {
  private client: OpenAI | undefined;

  constructor(private readonly configService: ConfigService<Env, true>) {}

  async embed(texts: string[]): Promise<number[][]> {
    const client = this.getClient();
    const response = await client.embeddings.create({ model: MODEL, input: texts });
    // Reordenado por `index` (defensivo — a API documenta ordem estável,
    // mas custa nada garantir em vez de confiar cegamente).
    return response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  private getClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    const apiKey = this.configService.get('OPENAI_API_KEY', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Processamento de documentos não está configurado nesta instância (OPENAI_API_KEY ausente).',
      );
    }

    this.client = new OpenAI({ apiKey });
    return this.client;
  }
}
