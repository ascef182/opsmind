import { OutreachQualityReviewer, parseQualityReview } from './outreach-quality-reviewer';

const validJson = JSON.stringify({
  scores: {
    personalization: 8,
    factualAccuracy: 9,
    naturalLanguage: 7,
    commercialRelevance: 8,
    ctaClarity: 9,
    genericLanguage: 7,
  },
  unsupportedClaims: ['perdem clientes à noite'],
  issues: ['abertura longa'],
});

describe('parseQualityReview', () => {
  it('lê o JSON mesmo com texto em volta e calcula a média', () => {
    expect(parseQualityReview(`Segue:\n${validJson}\nobrigado`)).toEqual({
      scores: {
        personalization: 8,
        factualAccuracy: 9,
        naturalLanguage: 7,
        commercialRelevance: 8,
        ctaClarity: 9,
        genericLanguage: 7,
      },
      average: 8,
      unsupportedClaims: ['perdem clientes à noite'],
      issues: ['abertura longa'],
    });
  });

  it.each([
    'sem json',
    '{"scores":{}}',
    JSON.stringify({ scores: { personalization: 11 }, unsupportedClaims: [], issues: [] }),
    validJson.replace('"unsupportedClaims":["perdem clientes à noite"]', '"unsupportedClaims":"x"'),
  ])('rejeita formato inválido: %p', (text) => {
    expect(parseQualityReview(text)).toBeNull();
  });
});

describe('OutreachQualityReviewer', () => {
  const input = {
    organizationId: 'org-1',
    monthlyBudget: null,
    actor: { type: 'SYSTEM' } as const,
    leadId: 'lead-1',
    channel: 'WHATSAPP',
    facts: 'FATOS VERIFICADOS:\n- Nome do negócio: Padaria',
    subject: undefined,
    body: 'Olá! Posso mostrar?',
  };

  it('usa o modelo de rotina com operação própria e devolve a revisão', async () => {
    const aiRunner = { run: jest.fn().mockResolvedValue({ text: validJson, model: 'claude-haiku-5-5' }) };
    const reviewer = new OutreachQualityReviewer(aiRunner as never);

    const result = await reviewer.review(input);

    expect(aiRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'outreach.quality_review', tier: 'routine' }),
    );
    expect(aiRunner.run.mock.calls[0][0].prompt).toContain('FATOS VERIFICADOS');
    expect(result).toMatchObject({ status: 'REVIEWED', model: 'claude-haiku-5-5', average: 8 });
  });

  it('tenta de novo uma vez quando o formato vem errado, depois marca como não revisado', async () => {
    const aiRunner = { run: jest.fn().mockResolvedValue({ text: 'nota 8', model: 'm' }) };
    const reviewer = new OutreachQualityReviewer(aiRunner as never);

    const result = await reviewer.review(input);

    expect(aiRunner.run).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('UNREVIEWED');
  });

  it('falha da chamada (orçamento, rede) não derruba o rascunho', async () => {
    const aiRunner = { run: jest.fn().mockRejectedValue(new Error('Orçamento mensal de IA atingido')) };
    const reviewer = new OutreachQualityReviewer(aiRunner as never);

    await expect(reviewer.review(input)).resolves.toEqual({
      status: 'UNREVIEWED',
      reason: 'Orçamento mensal de IA atingido',
    });
  });
});
