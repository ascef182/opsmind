import { checkOutreachGate, draftWordTarget, maxSimilarityToRecent } from './outreach-guardrails';

describe('checkOutreachGate', () => {
  it('aprova um corpo limpo, curto, sem link nenhum', () => {
    const result = checkOutreachGate('Vi que sua clínica não tem site. Topa uma call de 10 min?', 'ideia rápida');
    expect(result).toEqual({ passed: true, violations: [] });
  });

  it('bloqueia frase proibida já instruída no prompt (case-insensitive)', () => {
    const result = checkOutreachGate('Temos a SOLUÇÃO COMPLETA pro seu negócio.', null);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes('solução completa'))).toBe(true);
  });

  it('bloqueia cada uma das 4 frases citadas em OUTREACH_SYSTEM_PROMPT_LINES', () => {
    for (const phrase of ['imperdível', 'não perca essa oportunidade', 'revolucionário']) {
      const result = checkOutreachGate(`Isso é ${phrase}!`, null);
      expect(result.passed).toBe(false);
    }
  });

  it('bloqueia tag de merge não substituída, tanto {{chave}} quanto [MAIUSCULO]', () => {
    expect(checkOutreachGate('Olá {{nome}}, vi seu site.', null).passed).toBe(false);
    expect(checkOutreachGate('Olá [NOME], vi seu site.', null).passed).toBe(false);
    expect(checkOutreachGate('Vi seu site.', '[ASSUNTO]').passed).toBe(false);
  });

  it('bloqueia travessão no corpo ou no assunto (tell mais comum de texto gerado por IA)', () => {
    expect(checkOutreachGate('Vi seu site — muito bom, aliás.', null).passed).toBe(false);
    expect(checkOutreachGate('Vi seu site.', 'ideia rápida — pra vocês').passed).toBe(false);
  });

  it('aceita pontuação alternativa (ponto, vírgula, dois-pontos, parênteses) no lugar de travessão', () => {
    const result = checkOutreachGate('Vi seu site. Muito bom, aliás (de verdade): dá pra melhorar algo.', null);
    expect(result.passed).toBe(true);
  });

  it('bloqueia corpo com mais de 220 palavras', () => {
    const longBody = Array.from({ length: 221 }, () => 'palavra').join(' ');
    const result = checkOutreachGate(longBody, null);
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes('220 palavras'))).toBe(true);
  });

  it('aceita corpo com exatamente 220 palavras', () => {
    const body = Array.from({ length: 220 }, () => 'palavra').join(' ');
    expect(checkOutreachGate(body, null).passed).toBe(true);
  });

  it('pula a checagem de link fora de domínio quando allowedHosts não é passado', () => {
    const result = checkOutreachGate('Veja mais em https://totalmente-aleatorio.exemplo.com/oferta', null);
    expect(result.passed).toBe(true);
  });

  it('bloqueia link fora dos hosts permitidos quando allowedHosts é passado', () => {
    const result = checkOutreachGate('Veja mais em https://fora-do-dominio.exemplo.com/oferta', null, {
      allowedHosts: ['cazatech.solutions'],
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes('fora-do-dominio.exemplo.com'))).toBe(true);
  });

  it('aceita link dentro de um host permitido ou de um subdomínio dele', () => {
    const result = checkOutreachGate(
      'Agende em https://calendly.cazatech.solutions/call e veja https://cazatech.solutions/sobre',
      null,
      { allowedHosts: ['cazatech.solutions'] },
    );
    expect(result.passed).toBe(true);
  });

  it('acumula múltiplas violações simultâneas numa única chamada', () => {
    const result = checkOutreachGate('{{nome}}, temos a solução completa e é imperdível!', null);
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});

describe('frases de afirmação sem evidência', () => {
  it.each([
    'Um começo de reputação que dá gosto de ver.',
    'Quem manda mensagem à noite e fica sem resposta tende a procurar outra academia.',
    'Vocês estão perdendo clientes sem um site.',
  ])('bloqueia %p', (body) => {
    expect(checkOutreachGate(body, null).passed).toBe(false);
  });
});

describe('draftWordTarget', () => {
  it('canais de mensagem curta miram 100 palavras; e-mail e ligação têm mais folga', () => {
    expect(draftWordTarget('WHATSAPP')).toBe(100);
    expect(draftWordTarget('INSTAGRAM_DM')).toBe(100);
    expect(draftWordTarget('EMAIL')).toBe(130);
    expect(draftWordTarget('PHONE')).toBe(150);
  });
});

describe('maxSimilarityToRecent', () => {
  const template =
    'Olá! Encontrei a sua academia pesquisando no Google e não localizei um site próprio. Posso mostrar um conceito visual?';

  it('mesmo template com outro nome é quase idêntico', () => {
    const other = template.replace('sua academia', 'Arena Fit');
    expect(maxSimilarityToRecent(template, [other])).toBeGreaterThan(0.5);
  });

  it('textos diferentes ficam baixos e lista vazia é zero', () => {
    const different = 'Bom dia, vi que a Metalúrgica Maná atende Guarulhos inteira com serviços de solda e corte.';
    expect(maxSimilarityToRecent(template, [different])).toBeLessThan(0.1);
    expect(maxSimilarityToRecent(template, [])).toBe(0);
  });
});
