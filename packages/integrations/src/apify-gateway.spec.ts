import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapApifyItemToLead } from './apify-gateway';

// Fixture gravado a partir de um item "plausível" do actor
// `compass/google-maps-extractor` (não capturado de uma execução real —
// ver aviso em `apify-gateway.ts`), incluindo campos extras que o mapeamento
// ignora (categories, url, searchString, location, permanentlyClosed) pra
// garantir que eles ainda acabam em `raw` sem quebrar nada.
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'apify-google-maps-item.sample.json'), 'utf-8'),
) as Record<string, unknown>;

describe('mapApifyItemToLead', () => {
  it('mapeia um item completo do dataset do actor pros campos estáveis de ApifyBusinessResult', () => {
    const result = mapApifyItemToLead(fixture);

    expect(result).toEqual({
      name: 'Padaria Pão Dourado',
      address: 'Rua das Flores, 123',
      city: 'Campinas',
      state: 'SP',
      phone: '+5519912345678',
      website: 'https://paodouradopadaria.com.br',
      googleCategory: 'Padaria',
      rating: 4.6,
      reviewCount: 128,
      placeId: 'ChIJn8_random_place_id_123',
      raw: fixture,
    });
  });

  it('preserva o item bruto completo (inclusive campos não mapeados) em `raw`', () => {
    const result = mapApifyItemToLead(fixture);

    expect(result.raw.categories).toEqual(['Padaria', 'Confeitaria']);
    expect(result.raw.location).toEqual({ lat: -22.9099, lng: -47.0626 });
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
