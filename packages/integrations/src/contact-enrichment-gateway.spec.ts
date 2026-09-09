import { mapContactItem, mergeContactItems, mapInstagramItem } from './contact-enrichment-gateway';

describe('mapContactItem', () => {
  it('mapeia emails/phones e classifica cada array de rede social por platform', () => {
    const item = {
      emails: ['contato@padaria.com.br'],
      phones: ['+5519912345678'],
      instagrams: ['https://instagram.com/padaria'],
      facebooks: ['https://facebook.com/padaria'],
      linkedIns: ['https://linkedin.com/company/padaria'],
      twitters: ['https://twitter.com/padaria'],
      youtubes: ['https://youtube.com/@padaria'],
      whatsapps: ['https://wa.me/5519912345678'],
    };

    const result = mapContactItem(item);

    expect(result.emails).toEqual(['contato@padaria.com.br']);
    expect(result.phones).toEqual(['+5519912345678']);
    expect(result.socials).toEqual(
      expect.arrayContaining([
        { platform: 'INSTAGRAM', url: 'https://instagram.com/padaria' },
        { platform: 'FACEBOOK', url: 'https://facebook.com/padaria' },
        { platform: 'LINKEDIN', url: 'https://linkedin.com/company/padaria' },
        { platform: 'TWITTER', url: 'https://twitter.com/padaria' },
        { platform: 'YOUTUBE', url: 'https://youtube.com/@padaria' },
        { platform: 'WHATSAPP', url: 'https://wa.me/5519912345678' },
      ]),
    );
    expect(result.socials).toHaveLength(6);
  });

  it('nunca lança e devolve arrays vazios pra campos ausentes/tipo inesperado', () => {
    expect(() => mapContactItem({})).not.toThrow();
    const result = mapContactItem({ emails: 'não é array', phones: null });
    expect(result).toEqual({ emails: [], phones: [], socials: [] });
  });

  it('filtra entradas não-string dentro de um array', () => {
    const result = mapContactItem({ emails: ['a@b.com', 123, null], phones: [] });
    expect(result.emails).toEqual(['a@b.com']);
  });
});

describe('mergeContactItems', () => {
  it('junta emails/phones/socials de múltiplos itens (múltiplas páginas do mesmo site), deduplicando', () => {
    const items = [
      { emails: ['a@x.com'], phones: [], instagrams: ['https://instagram.com/x'] },
      { emails: ['a@x.com', 'b@x.com'], phones: ['+551999999'], instagrams: ['https://instagram.com/x'] },
    ];

    const result = mergeContactItems(items);

    expect(result.emails.sort()).toEqual(['a@x.com', 'b@x.com']);
    expect(result.phones).toEqual(['+551999999']);
    // Mesmo instagram (platform+url) nos dois itens — dedup, aparece só 1 vez.
    expect(result.socials).toEqual([{ platform: 'INSTAGRAM', url: 'https://instagram.com/x' }]);
  });

  it('devolve tudo vazio pra uma lista de itens vazia', () => {
    expect(mergeContactItems([])).toEqual({ emails: [], phones: [], socials: [] });
  });
});

describe('mapInstagramItem', () => {
  it('extrai bio/email e reconhece link de WhatsApp em externalUrl', () => {
    const item = {
      biography: 'Padaria artesanal desde 1990',
      externalUrl: 'https://wa.me/5519912345678',
      businessEmail: 'contato@padaria.com.br',
    };

    const result = mapInstagramItem(item);

    expect(result).toEqual({
      bio: 'Padaria artesanal desde 1990',
      whatsappLink: 'https://wa.me/5519912345678',
      email: 'contato@padaria.com.br',
    });
  });

  it('cai para reconhecer link de WhatsApp dentro do texto da bio quando não há externalUrl', () => {
    const item = {
      biography: 'Peça já pelo WhatsApp: https://api.whatsapp.com/send?phone=5519912345678',
      externalUrl: null,
    };

    const result = mapInstagramItem(item);

    expect(result.whatsappLink).toBe('https://api.whatsapp.com/send?phone=5519912345678');
  });

  it('devolve whatsappLink/email null quando nada é reconhecível, nunca lança', () => {
    expect(() => mapInstagramItem({})).not.toThrow();
    const result = mapInstagramItem({ biography: 'Sem nenhum link', externalUrl: 'https://meusite.com' });
    expect(result).toEqual({ bio: 'Sem nenhum link', whatsappLink: null, email: null });
  });

  it('usa publicEmail como fallback quando businessEmail está ausente', () => {
    const result = mapInstagramItem({ publicEmail: 'outro@padaria.com.br' });
    expect(result.email).toBe('outro@padaria.com.br');
  });
});
