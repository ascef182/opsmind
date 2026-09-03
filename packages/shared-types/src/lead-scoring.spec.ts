import { QUALIFICATION_THRESHOLD, scoreLead, type ServiceOfferingIcp } from './lead-scoring';

const restaurantOffering: ServiceOfferingIcp = {
  id: 'offering-restaurant',
  signals: ['delivery próprio', 'cardápio online', 'reserva pelo site', 'fila de espera'],
  targetIndustries: ['restaurante'],
  minEmployees: 5,
  maxEmployees: 50,
  minRevenueUsd: 100_000,
  maxRevenueUsd: 2_000_000,
};

describe('scoreLead', () => {
  it('negócio sem site + firmographics batendo tudo => score alto (100, clamped)', () => {
    const result = scoreLead(
      {
        website: null,
        googleCategory: 'Restaurante Italiano',
        rating: 4.5,
        reviewCount: 120,
        rawContent: null,
        firmographics: { industry: 'restaurante', employeeCount: 20, revenueUsd: 500_000 },
      },
      [restaurantOffering],
    );

    expect(result.hasNoWebsitePoints).toBe(50);
    expect(result.icpFitPoints).toBe(30); // 10 (industry) + 10 (employees) + 10 (revenue)
    expect(result.activityPoints).toBe(20); // reviewCount>0 + rating>=4.0
    expect(result.keywordMatchPoints).toBe(0); // firmographics presente => fallback não roda
    expect(result.total).toBe(100);
    expect(result.matchedOfferingId).toBe('offering-restaurant');
    expect(result.total).toBeGreaterThanOrEqual(QUALIFICATION_THRESHOLD);
  });

  it('negócio com site => hasNoWebsitePoints = 0', () => {
    const result = scoreLead(
      {
        website: 'https://restaurante-exemplo.com',
        googleCategory: 'Restaurante Italiano',
        rating: 4.5,
        reviewCount: 120,
        rawContent: null,
        firmographics: { industry: 'restaurante', employeeCount: 20, revenueUsd: 500_000 },
      },
      [restaurantOffering],
    );

    expect(result.hasNoWebsitePoints).toBe(0);
    expect(result.total).toBe(50); // 30 (icp fit) + 20 (activity), sem os 50 do website
  });

  it('lead sem firmographics mas com rawContent batendo signals => fallback de keyword ativado', () => {
    const result = scoreLead(
      {
        website: null,
        googleCategory: 'Restaurante',
        rating: null,
        reviewCount: null,
        rawContent: 'Site novo! Temos delivery próprio e cardápio online, confira.',
        firmographics: null,
      },
      [restaurantOffering],
    );

    // 2 de 4 signals bateram ("delivery próprio", "cardápio online") => round(2/4*60) = 30
    expect(result.icpFitPoints).toBe(0); // sem firmographics, ICP fit não roda
    expect(result.keywordMatchPoints).toBe(30);
    expect(result.matchedOfferingId).toBe('offering-restaurant');
    expect(result.matchedSignals.sort()).toEqual(['cardápio online', 'delivery próprio'].sort());
    expect(result.total).toBe(50 + 30); // hasNoWebsite + keyword match, sem activity
  });

  it('nenhuma offering ativa => score só de hasNoWebsite + activity', () => {
    const result = scoreLead(
      {
        website: null,
        googleCategory: 'Restaurante',
        rating: 4.2,
        reviewCount: 5,
        rawContent: 'Qualquer conteúdo bruto aqui, sem offering pra casar.',
        firmographics: null,
      },
      [],
    );

    expect(result.hasNoWebsitePoints).toBe(50);
    expect(result.icpFitPoints).toBe(0);
    expect(result.keywordMatchPoints).toBe(0);
    expect(result.activityPoints).toBe(20);
    expect(result.total).toBe(70);
    expect(result.matchedOfferingId).toBeNull();
    expect(result.matchedSignals).toEqual([]);
  });

  it('múltiplas offerings => escolhe a de mais matches, mesmo com menos signals no total', () => {
    const offeringA: ServiceOfferingIcp = {
      id: 'offering-a',
      signals: ['sinal-1', 'sinal-2', 'sinal-3'],
      targetIndustries: [],
      minEmployees: null,
      maxEmployees: null,
      minRevenueUsd: null,
      maxRevenueUsd: null,
    };
    const offeringB: ServiceOfferingIcp = {
      id: 'offering-b',
      signals: ['sinal-x', 'sinal-y'],
      targetIndustries: [],
      minEmployees: null,
      maxEmployees: null,
      minRevenueUsd: null,
      maxRevenueUsd: null,
    };

    const result = scoreLead(
      {
        website: 'https://exemplo.com',
        googleCategory: null,
        rating: null,
        reviewCount: null,
        rawContent: 'Conteúdo com sinal-1, sinal-x e sinal-y, mas não os outros.',
        firmographics: null,
      },
      [offeringA, offeringB],
    );

    // offeringA: 1/3 matches; offeringB: 2/2 matches => B vence (mais matches)
    expect(result.matchedOfferingId).toBe('offering-b');
    expect(result.keywordMatchPoints).toBe(60); // round(2/2*60)
  });
});
