import { classifyLeadCandidate, isQualifiableEntity } from './lead-classification';

const search = (name: string, url: string | null) => classifyLeadCandidate({ name, url, structuredSource: false });

describe('classifyLeadCandidate', () => {
  it('flags directories by domain, including subdomains', () => {
    expect(search('Dentistas em Santos', 'https://www.doctoralia.com.br/dentista/santos')).toEqual({
      entityType: 'DIRECTORY',
      reason: 'DIRECTORY_DOMAIN',
    });
    expect(search('Imóveis', 'https://sp.olx.com.br/imoveis')).toEqual({ entityType: 'DIRECTORY', reason: 'DIRECTORY_DOMAIN' });
  });

  it('flags listicles', () => {
    expect(search('As 20 melhores barbearias em São Paulo', 'https://blog.exemplo.com.br/barbearias').reason).toBe('LISTICLE_TITLE');
    expect(search('Os mais recomendados dentistas de Campo Belo', 'https://site.com').reason).toBe('LISTICLE_TITLE');
  });

  it('flags internal pages such as contact, news and category', () => {
    for (const path of ['/contato', '/noticias/2024/abertura', '/categoria/dentistas', '/blog/post']) {
      expect(search('Clínica Sorriso', `https://clinicasorriso.com.br${path}`)).toEqual({
        entityType: 'INTERNAL_PAGE',
        reason: 'INTERNAL_PAGE_PATH',
      });
    }
  });

  it('flags search engine artifacts', () => {
    expect(search('See more on clinicasoraldents.com.br', 'https://clinicasoraldents.com.br').entityType).toBe('IRRELEVANT');
    expect(search('Próximo|2Os mais recomendados', 'https://google.com').entityType).toBe('IRRELEVANT');
  });

  it('keeps a company home page and recognizes professionals', () => {
    expect(search('Quallis Odontologia', 'https://quallis.com.br/')).toEqual({ entityType: 'BUSINESS', reason: null });
    expect(search('Dra. Vera Pereira', 'https://veradentista.com.br')).toEqual({ entityType: 'PROFESSIONAL', reason: null });
  });

  it('trusts structured sources as businesses', () => {
    expect(classifyLeadCandidate({ name: 'Top 10 Barbearia', url: null, structuredSource: true }).entityType).toBe('BUSINESS');
  });

  it('only businesses, professionals and unknown legacy rows can qualify', () => {
    expect(isQualifiableEntity('BUSINESS')).toBe(true);
    expect(isQualifiableEntity('UNKNOWN')).toBe(true);
    expect(isQualifiableEntity('DIRECTORY')).toBe(false);
    expect(isQualifiableEntity('INTERNAL_PAGE')).toBe(false);
  });
});
