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
        // Fonte estruturada (tem firmographics) — ausência de site é
        // CONFIRMADA pela própria busca (Apify/Explorium), não um gap de
        // captura.
        websiteConfirmedAbsent: true,
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
        websiteConfirmedAbsent: false,
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

  it('lead sem firmographics mas com rawContent batendo signals => fallback de keyword ativado (fonte não-estruturada, ex. Camoufox — nunca confirma ausência de site)', () => {
    const result = scoreLead(
      {
        website: null,
        // Formato real de um lead do Camoufox: sem firmographics, só
        // rawContent — o campo `website` nunca foi observado, então NUNCA
        // é "confirmado ausente" (achado real, 2026-09: antes deste campo
        // existir, todo lead do Camoufox ganhava os 50 pontos aqui mesmo
        // sem nenhuma evidência de que o negócio de fato não tem site).
        websiteConfirmedAbsent: false,
        googleCategory: 'Restaurante',
        rating: null,
        reviewCount: null,
        rawContent: 'Site novo! Temos delivery próprio e cardápio online, confira.',
        firmographics: null,
      },
      [restaurantOffering],
    );

    // 2 de 4 signals bateram ("delivery próprio", "cardápio online") => round(2/4*60) = 30
    expect(result.hasNoWebsitePoints).toBe(0); // nunca confirmado, nunca premiado
    expect(result.icpFitPoints).toBe(0); // sem firmographics, ICP fit não roda
    expect(result.keywordMatchPoints).toBe(30);
    expect(result.matchedOfferingId).toBe('offering-restaurant');
    expect(result.matchedSignals.sort()).toEqual(['cardápio online', 'delivery próprio'].sort());
    expect(result.total).toBe(30); // só keyword match, sem os 50 de hasNoWebsite
    expect(result.total).toBeLessThan(QUALIFICATION_THRESHOLD); // não qualifica só por bater 1-2 keywords genéricas
  });

  it('nenhuma offering ativa => score só de hasNoWebsite + activity', () => {
    const result = scoreLead(
      {
        website: null,
        // Fonte estruturada com rating/reviewCount reais (ex. Apify), só
        // sem nenhuma ServiceOffering ativa pra casar — ausência de site
        // continua confirmada independente disso.
        websiteConfirmedAbsent: true,
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
        websiteConfirmedAbsent: false,
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

  it('lead só de fonte Apify (sem rawContent, sem firmographics) casa oferta pela googleCategory', () => {
    const bakeryOffering: ServiceOfferingIcp = {
      id: 'offering-site',
      signals: ['padaria', 'bakery'],
      targetIndustries: [],
      minEmployees: null,
      maxEmployees: null,
      minRevenueUsd: null,
      maxRevenueUsd: null,
    };

    const result = scoreLead(
      {
        website: null,
        // Apify confirma ausência de site na própria busca do Google Maps,
        // mesmo sem Explorium pra firmographics.
        websiteConfirmedAbsent: true,
        googleCategory: 'Bakery',
        rating: null,
        reviewCount: null,
        rawContent: null, // Apify nunca preenche isso — cenário real sem Explorium
        firmographics: null,
      },
      [bakeryOffering],
    );

    expect(result.keywordMatchPoints).toBe(30); // 1 de 2 signals ("bakery") => round(1/2*60)
    expect(result.matchedOfferingId).toBe('offering-site');
    expect(result.matchedSignals).toEqual(['bakery']);
  });

  // Regressão direta do bug real reportado (2026-09): uma página de portal
  // imobiliário ("766 imobiliárias em São Paulo... - Imovelweb") batendo só
  // a palavra-chave genérica da categoria não pode mais qualificar um lead
  // do Camoufox sozinha — antes desta correção, `hasNoWebsitePoints: 50`
  // sozinho já cruzava QUALIFICATION_THRESHOLD independente do conteúdo.
  it('página de diretório/portal com 1 keyword genérica batendo, sem site confirmado => não qualifica', () => {
    const realEstateOffering: ServiceOfferingIcp = {
      id: 'offering-imobiliaria',
      signals: [
        'imobiliária', 'corretor', 'aluguel', 'venda de imóveis', 'apartamento',
        'casa à venda', 'financiamento', 'avaliação de imóvel', 'plantão de vendas',
        'lançamento imobiliário', 'permuta', 'locação',
      ],
      targetIndustries: [],
      minEmployees: null,
      maxEmployees: null,
      minRevenueUsd: null,
      maxRevenueUsd: null,
    };

    const result = scoreLead(
      {
        website: null,
        websiteConfirmedAbsent: false, // Camoufox — nunca confirma isso
        googleCategory: null,
        rating: null,
        reviewCount: null,
        rawContent: '766 imobiliárias em São Paulo Estado de São Paulo - Imovelweb',
        firmographics: null,
      },
      [realEstateOffering],
    );

    expect(result.hasNoWebsitePoints).toBe(0);
    expect(result.keywordMatchPoints).toBeLessThanOrEqual(10); // 1 de 12 signals => round(1/12*60) = 5
    expect(result.total).toBeLessThan(QUALIFICATION_THRESHOLD);
  });
});
