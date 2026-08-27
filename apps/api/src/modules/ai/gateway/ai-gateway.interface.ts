import type Anthropic from '@anthropic-ai/sdk';

/**
 * Abstração sobre o provedor de IA (Decisão de arquitetura — PRD §17: "AI
 * Gateway (1 provider)" já desenhado como interface trocável, mesmo com um
 * único provider hoje). Reaproveita os tipos do SDK oficial da Anthropic em
 * vez de redefinir formatos equivalentes — só o suficiente de abstração para
 * `AiService` ser testável sem bater na API real e para o e2e sobrescrever
 * este provider por um mock (não há chave de API real neste ambiente).
 */
export interface AiGatewayRequest {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
}

export interface AiGateway {
  sendMessage(request: AiGatewayRequest): Promise<Anthropic.Message>;
}

export const AI_GATEWAY = Symbol('AI_GATEWAY');
