import { classifyBusinessWebsite } from './business-website';

describe('classifyBusinessWebsite', () => {
  it.each([
    ['https://www.facebook.com/www.campsteel.com.br?mibextid=ZbWKwL', 'FACEBOOK'],
    ['https://pt-br.facebook.com/padaria', 'FACEBOOK'],
    ['https://m.facebook.com/padaria', 'FACEBOOK'],
    ['http://instagram.com/barbearia', 'INSTAGRAM'],
    ['http://instagran.com/henriqueusinagem/', 'INSTAGRAM'],
    ['instagram.com/semscheme', 'INSTAGRAM'],
    ['https://www.linkedin.com/company/acme', 'LINKEDIN'],
    ['https://www.tiktok.com/@salao', 'TIKTOK'],
    ['https://x.com/loja', 'TWITTER'],
    ['https://www.youtube.com/@canal', 'YOUTUBE'],
    ['https://linktr.ee/clinica', 'OTHER'],
    ['https://links.nextfit.bio/academia', 'OTHER'],
  ])('%p é rede social / link na bio (%p), não site', (url, platform) => {
    const result = classifyBusinessWebsite(url);

    expect(result.kind).toBe('social');
    expect(result.kind === 'social' && result.link).toEqual({ platform, url });
  });

  it('wa.me vira WhatsApp com o número extraído', () => {
    const result = classifyBusinessWebsite('https://wa.me/5519991234567');

    expect(result).toEqual({
      kind: 'social',
      link: { platform: 'WHATSAPP', url: 'https://wa.me/5519991234567' },
      whatsappNumber: '5519991234567',
    });
  });

  it('api.whatsapp.com/send?phone=… também extrai o número', () => {
    const result = classifyBusinessWebsite('https://api.whatsapp.com/send?phone=+1%20512-555-0199');

    expect(result.kind === 'social' && result.whatsappNumber).toBe('15125550199');
  });

  it.each([
    'http://usinebra.com.br/',
    'https://www.mecsol.com.br/',
    'https://sites.google.com/view/negocio',
    'https://notfacebook.com/x',
    'https://facebook.com.evil.example/x',
  ])('%p continua sendo site', (url) => {
    expect(classifyBusinessWebsite(url)).toEqual({ kind: 'website', url });
  });

  it('URL ininterpretável continua como site (na dúvida, não afirma que não há site)', () => {
    expect(classifyBusinessWebsite('http://')).toEqual({ kind: 'website', url: 'http://' });
  });
});
