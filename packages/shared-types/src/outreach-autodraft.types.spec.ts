import { resolveAutodraftChannel } from './outreach-autodraft.types';

describe('resolveAutodraftChannel', () => {
  it('prioriza WHATSAPP quando presente, mesmo com outros campos preenchidos', () => {
    expect(resolveAutodraftChannel({
      whatsapp: '+5511999999999', email: 'a@b.com', phone: '1133334444', socialLinks: [],
    })).toBe('WHATSAPP');
  });

  it('prioriza INSTAGRAM_DM sobre LINKEDIN_DM/EMAIL/PHONE quando não há whatsapp', () => {
    expect(resolveAutodraftChannel({
      whatsapp: null, email: 'a@b.com', phone: '1133334444',
      socialLinks: [{ platform: 'INSTAGRAM', url: 'https://instagram.com/x' }, { platform: 'LINKEDIN', url: 'https://linkedin.com/x' }],
    })).toBe('INSTAGRAM_DM');
  });

  it('prioriza LINKEDIN_DM sobre EMAIL/PHONE quando não há whatsapp nem instagram', () => {
    expect(resolveAutodraftChannel({
      whatsapp: null, email: 'a@b.com', phone: '1133334444',
      socialLinks: [{ platform: 'LINKEDIN', url: 'https://linkedin.com/x' }],
    })).toBe('LINKEDIN_DM');
  });

  it('cai para EMAIL quando só sobra email e phone', () => {
    expect(resolveAutodraftChannel({ whatsapp: null, email: 'a@b.com', phone: '1133334444', socialLinks: [] })).toBe('EMAIL');
  });

  it('cai para PHONE quando só sobra phone', () => {
    expect(resolveAutodraftChannel({ whatsapp: null, email: null, phone: '1133334444', socialLinks: [] })).toBe('PHONE');
  });

  it('retorna null quando nenhum dos cinco campos está preenchido', () => {
    expect(resolveAutodraftChannel({ whatsapp: null, email: null, phone: null, socialLinks: [] })).toBeNull();
  });

  it('nunca lança e trata socialLinks com shape inesperado (não-array/null) como ausência de redes', () => {
    expect(resolveAutodraftChannel({ whatsapp: null, email: null, phone: null, socialLinks: null })).toBeNull();
    expect(resolveAutodraftChannel({ whatsapp: null, email: null, phone: null, socialLinks: { foo: 'bar' } })).toBeNull();
  });

  it('nunca lança com uma entrada null/malformada dentro do array de socialLinks, e ainda acha o canal válido seguinte', () => {
    expect(
      resolveAutodraftChannel({
        whatsapp: null,
        email: 'a@b.com',
        phone: null,
        socialLinks: [null, { platform: 'EMAIL_ONLY_NOT_REAL' }],
      }),
    ).toBe('EMAIL');
    expect(
      resolveAutodraftChannel({ whatsapp: null, email: null, phone: null, socialLinks: [null, undefined] }),
    ).toBeNull();
  });
});
