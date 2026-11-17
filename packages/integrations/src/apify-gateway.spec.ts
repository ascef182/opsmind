import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapApifyItemToLead } from './apify-gateway';

// Itens reais do actor `compass/google-maps-extractor` (execução de
// 2026-11-09, busca "Metalúrgica" em Campinas), reduzidos aos campos
// relevantes: um negócio com site e telefone, outro sem nenhum dos dois.
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'apify-google-maps-item.sample.json'), 'utf-8'),
) as Record<string, unknown>;
const noWebsiteFixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'apify-google-maps-item-no-website.sample.json'), 'utf-8'),
) as Record<string, unknown>;

describe('mapApifyItemToLead', () => {
  it('mapeia um item real do dataset do actor pros campos estáveis de ApifyBusinessResult', () => {
    const result = mapApifyItemToLead(fixture);

    expect(result).toEqual({
      name: 'Usinebra Metalúrgica',
      address: 'R. Maria Fausta Figueiredo Chaib, 75 - Jardim Myrian Moreira da Costa, Campinas - SP, 13098-419, Brazil',
      city: 'Campinas',
      state: 'São Paulo',
      phone: '+551932571999',
      website: 'http://usinebra.com.br/',
      googleCategory: 'Metallurgy company',
      rating: 5,
      reviewCount: 1,
      placeId: 'ChIJafgU2nHEyJQR_J3lcpOPvi4',
      raw: fixture,
    });
  });

  it('sem site (chave ausente) e sem telefone (string vazia) viram null, nunca ""', () => {
    const result = mapApifyItemToLead(noWebsiteFixture);

    expect(result.website).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.rating).toBeNull();
    expect(result.reviewCount).toBeNull();
  });

  it('preserva o item bruto completo (inclusive countryCode e link do Maps) em `raw`', () => {
    const result = mapApifyItemToLead(fixture);

    expect(result.raw.countryCode).toBe('BR');
    expect(result.raw.url).toEqual(expect.stringContaining('query_place_id=ChIJafgU2nHEyJQR_J3lcpOPvi4'));
  });

  it('nunca lança erro e usa null para campos ausentes', () => {
    const sparseItem = { title: 'Só o nome' };

    const result = mapApifyItemToLead(sparseItem);

    expect(result).toEqual({
      name: 'Só o nome',
      address: null,
      city: null,
      state: null,
      phone: null,
      website: null,
      googleCategory: null,
      rating: null,
      reviewCount: null,
      placeId: null,
      raw: sparseItem,
    });
  });

  it('usa string vazia pro nome quando até o título está ausente, nunca lança erro', () => {
    expect(() => mapApifyItemToLead({})).not.toThrow();
    expect(mapApifyItemToLead({}).name).toBe('');
  });

  it('ignora campos com tipo inesperado em vez de propagá-los', () => {
    const malformedItem = {
      title: 123, // deveria ser string
      totalScore: '4.6', // deveria ser number
      reviewsCount: null,
    };

    const result = mapApifyItemToLead(malformedItem);

    expect(result.name).toBe('');
    expect(result.rating).toBeNull();
    expect(result.reviewCount).toBeNull();
  });
});
