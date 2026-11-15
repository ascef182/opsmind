export interface AiModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

// Preços por 1M tokens, usados para estimar custo/orçamento de IA — SEMPRE a
// partir do `model` que a resposta real da Anthropic devolveu
// (`response.model`), nunca de uma constante hardcoded por serviço (ver
// comentário em ai.service.ts/outreach.service.ts/etc. sobre o bug que isso
// corrigiu: antes, 5 serviços gravavam `'claude-opus-5'` mesmo quando
// `ANTHROPIC_MODEL` resolvia para outro modelo, ex. durante `pnpm --filter
// api eval`, que roda em claude-sonnet-5).
export const AI_MODEL_PRICING: Record<string, AiModelPricing> = {
  'claude-opus-5': { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  'claude-sonnet-5': { inputPerMillionUsd: 2, outputPerMillionUsd: 10 },
};

const DEFAULT_PRICING: AiModelPricing = { inputPerMillionUsd: 5, outputPerMillionUsd: 25 };

// Nunca lança por modelo desconhecido (ex.: a API retorna um modelo novo
// antes desta tabela ser atualizada) — cai no preço mais caro conhecido, pra
// nunca subestimar custo/orçamento em silêncio.
export function getAiModelPricing(model: string): AiModelPricing {
  return AI_MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

export function estimateAiCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getAiModelPricing(model);
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillionUsd +
    (outputTokens / 1_000_000) * pricing.outputPerMillionUsd
  );
}

// Label usado só nas linhas de AIRequest onde nenhuma resposta real da API
// chegou a existir (ex.: BUDGET_EXCEEDED antes de qualquer sendMessage(), ou
// erro de rede antes da primeira resposta) — nesses casos `estimatedCost` já
// é sempre 0, então o label não afeta orçamento, só observabilidade/auditoria.
export const AI_MODEL_LABEL_UNKNOWN = 'unknown';
