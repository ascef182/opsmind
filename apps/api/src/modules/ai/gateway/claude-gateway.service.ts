import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '@opsmind/config/env/schema';
import type { AiGateway, AiGatewayRequest, AiModelTier } from './ai-gateway.interface';

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
      model: this.resolveModel(request.tier),
      max_tokens: request.maxTokens ?? MAX_TOKENS,
      thinking: { type: 'adaptive' },
      ...(request.effort ? { output_config: { effort: request.effort } } : {}),
      system: request.system,
      messages: request.messages,
      tools: request.tools,
    }) as Promise<Anthropic.Message>;
  }

  private resolveModel(tier: AiModelTier = 'default'): string {
    if (tier === 'routine') {
      return this.configService.get('ANTHROPIC_MODEL_ROUTINE', { infer: true });
    }
    if (tier === 'standard') {
      return this.configService.get('ANTHROPIC_MODEL_STANDARD', { infer: true });
    }
    return this.configService.get('ANTHROPIC_MODEL', { infer: true });
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

    // `ANTHROPIC_WORKSPACE_ID` — só necessário quando a chave é de
    // ORGANIZAÇÃO, não escopada a nenhum workspace (achado ao vivo, plano
    // pensando-como-empresa-com-agile-beaver.md: a API recusa toda request
    // dessas chaves com "This API key is not scoped to a workspace" até o
    // header `anthropic-workspace-id` dizer qual workspace usar). Uma chave
    // já escopada não precisa disso — `defaultHeaders` fica de fora nesse
    // caso, em vez de mandar um header vazio à toa.
    const workspaceId = this.configService.get('ANTHROPIC_WORKSPACE_ID', { infer: true });
    this.client = new Anthropic({
      apiKey,
      ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
    });
    return this.client;
  }
}
