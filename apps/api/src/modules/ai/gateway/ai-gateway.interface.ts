import type Anthropic from '@anthropic-ai/sdk';

/**
 * Abstração sobre o provedor de IA (Decisão de arquitetura — PRD §17: "AI
 * Gateway (1 provider)" já desenhado como interface trocável, mesmo com um
 * único provider hoje). Reaproveita os tipos do SDK oficial da Anthropic em
 * vez de redefinir formatos equivalentes — só o suficiente de abstração para
 * `AiService` ser testável sem bater na API real e para o e2e sobrescrever
 * este provider por um mock (não há chave de API real neste ambiente).
 */
// `default`: o modelo de `ANTHROPIC_MODEL` (chat com tools). `standard`:
// redação e personalização (rascunho de outreach, proposta). `routine`:
// classificação e extração em volume. A escolha do tier é do chamador; qual
// modelo cada tier usa é configuração (`ANTHROPIC_MODEL_STANDARD`/`_ROUTINE`).
export type AiModelTier = 'default' | 'standard' | 'routine';

export type AiEffort = 'low' | 'medium' | 'high';

export interface AiGatewayRequest {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  tier?: AiModelTier;
  maxTokens?: number;
  // Profundidade de raciocínio/gasto de tokens. Omitido = default do modelo.
  // O jeito suportado de baratear uma chamada simples: desligar thinking
  // retorna 400 em parte dos modelos atuais.
  effort?: AiEffort;
}

export interface AiGateway {
  sendMessage(request: AiGatewayRequest): Promise<Anthropic.Message>;
}

export const AI_GATEWAY = Symbol('AI_GATEWAY');
