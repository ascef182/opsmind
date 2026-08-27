/**
 * Abstração sobre o provedor de embeddings — Anthropic não tem endpoint de
 * embeddings (PRD §16 já lista OpenAI ao lado de Anthropic no AI Gateway),
 * então esta é uma segunda interface de IA trocável, separada de AiGateway
 * (Fase 3). Permite ao e2e sobrescrever por um mock (sem chave real neste
 * ambiente), do mesmo jeito que AI_GATEWAY.
 */
export interface EmbeddingGateway {
  /** Uma chamada por lote (a API da OpenAI aceita array de inputs de uma vez). */
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_GATEWAY = Symbol('EMBEDDING_GATEWAY');
