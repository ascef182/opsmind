import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '@opsmind/config/env/schema';
import type { AiGateway, AiGatewayRequest } from './ai-gateway.interface';

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 4096;

/**
 * Implementação real de `AiGateway` via SDK oficial da Anthropic (claude-api
 * skill: usar sempre o SDK, nunca HTTP cru; modelo padrão claude-opus-5;
 * thinking adaptativo por padrão para qualquer coisa remotamente complexa —
 * decidir qual tool chamar, com base em contexto de negócio, qualifica).
 *
 * O client só é construído no primeiro `sendMessage()`, não no construtor:
 * `ANTHROPIC_API_KEY` é deliberadamente opcional no schema de env
 * (packages/config/env/schema.ts) para não travar o boot da API inteira num
 * ambiente sem IA configurada. A falta da chave falha aqui, alto e claro, só
 * quando alguém de fato tenta usar o assistente.
 */
@Injectable()
export class ClaudeGatewayService implements AiGateway {
  private client: Anthropic | undefined;

  constructor(private readonly configService: ConfigService<Env, true>) {}

  async sendMessage(request: AiGatewayRequest): Promise<Anthropic.Message> {
    const client = this.getClient();
    return client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      system: request.system,
      messages: request.messages,
      tools: request.tools,
    }) as Promise<Anthropic.Message>;
  }

  private getClient(): Anthropic {
    if (this.client) {
      return this.client;
    }

    const apiKey = this.configService.get('ANTHROPIC_API_KEY', { infer: true });
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Assistente de IA não está configurado nesta instância (ANTHROPIC_API_KEY ausente).',
      );
    }

    this.client = new Anthropic({ apiKey });
    return this.client;
  }
}
