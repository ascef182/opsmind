import { AI_MODEL_LABEL_UNKNOWN, estimateAiCostUsd, getAiModelPricing } from './ai-model-pricing';

describe('getAiModelPricing', () => {
  it('retorna o preço exato de claude-opus-5', () => {
    expect(getAiModelPricing('claude-opus-5')).toEqual({
      inputPerMillionUsd: 5,
      outputPerMillionUsd: 25,
    });
  });

  it('retorna o preço exato de claude-sonnet-5', () => {
    expect(getAiModelPricing('claude-sonnet-5')).toEqual({
      inputPerMillionUsd: 2,
      outputPerMillionUsd: 10,
    });
  });

  it('cai no preço mais caro conhecido (opus-5) para um modelo desconhecido — nunca subestima custo em silêncio', () => {
    expect(getAiModelPricing('claude-future-model-99')).toEqual(
      getAiModelPricing('claude-opus-5'),
    );
  });
});

describe('estimateAiCostUsd', () => {
  it('calcula custo combinando tokens de input e output pelo preço do modelo', () => {
    // 1_000_000 input tokens a $5/MTok (opus-5) = $5; 500_000 output tokens a $25/MTok = $12.5
    const cost = estimateAiCostUsd('claude-opus-5', 1_000_000, 500_000);
    expect(cost).toBeCloseTo(17.5, 5);
  });

  it('usa o preço de um modelo diferente quando o modelo muda (ex.: eval em sonnet-5)', () => {
    // 1_000_000 input tokens a $2/MTok (sonnet-5) = $2; 1_000_000 output tokens a $10/MTok = $10
    const cost = estimateAiCostUsd('claude-sonnet-5', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(12, 5);
  });
});

describe('AI_MODEL_LABEL_UNKNOWN', () => {
  it('é uma string estável usável como label quando nenhuma resposta real da API chegou', () => {
    expect(AI_MODEL_LABEL_UNKNOWN).toBe('unknown');
  });
});
