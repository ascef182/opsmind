import { isWhatsappHeavySegment, selectOutreachStrategy } from './outreach-strategy';

const base = { website: null, signalCodes: null, whatsappKnown: false, category: null, name: 'Negócio' };

describe('selectOutreachStrategy', () => {
  it('academia sem site e com WhatsApp recebe DeskComm (caso Sparta 1507)', () => {
    const result = selectOutreachStrategy({
      ...base,
      name: 'SPARTA 1507',
      category: 'Academia',
      whatsappKnown: true,
    });

    expect(result.strategy).toBe('WHATSAPP_AUTOMATION');
  });

  it('metalúrgica sem site e com WhatsApp recebe site (caso Metalúrgica Maná)', () => {
    const result = selectOutreachStrategy({
      ...base,
      name: 'Metalúrgica Maná',
      category: 'Metalúrgica',
      whatsappKnown: true,
    });

    expect(result).toEqual({ strategy: 'NO_WEBSITE', reasons: ['não localizamos um site próprio na pesquisa'] });
  });

  it('academia sem site e sem WhatsApp recebe site', () => {
    expect(selectOutreachStrategy({ ...base, category: 'Academia' }).strategy).toBe('NO_WEBSITE');
  });

  it('perfil de rede social no campo de site conta como sem site', () => {
    expect(selectOutreachStrategy({ ...base, website: 'https://instagram.com/loja' }).strategy).toBe('NO_WEBSITE');
  });

  it('site nunca analisado vira GENERAL', () => {
    expect(selectOutreachStrategy({ ...base, website: 'https://acme.com.br' }).strategy).toBe('GENERAL');
  });

  it('sinais de site antigo vencem os demais e viram motivos', () => {
    const result = selectOutreachStrategy({
      ...base,
      website: 'https://acme.com.br',
      whatsappKnown: true,
      signalCodes: ['website.no_ssl', 'website.no_contact_form', 'social.has_whatsapp_link'],
    });

    expect(result).toEqual({ strategy: 'OUTDATED_WEBSITE', reasons: ['o site não abre com HTTPS'] });
  });

  it('site sem formulário vira conversão fraca', () => {
    const result = selectOutreachStrategy({
      ...base,
      website: 'https://acme.com.br',
      signalCodes: ['website.no_contact_form'],
    });

    expect(result.strategy).toBe('WEAK_CONVERSION');
  });

  it('site bom com link de WhatsApp vira DeskComm', () => {
    const result = selectOutreachStrategy({
      ...base,
      website: 'https://acme.com.br',
      signalCodes: ['social.has_whatsapp_link'],
    });

    expect(result.strategy).toBe('WHATSAPP_AUTOMATION');
  });

  it('site bom sem WhatsApp não força oferta', () => {
    const result = selectOutreachStrategy({ ...base, website: 'https://acme.com.br', signalCodes: [] });

    expect(result.strategy).toBe('STRONG_PRESENCE');
  });
});

describe('isWhatsappHeavySegment', () => {
  it.each([
    ['Centro de Artes Marciais', 'Toca da Luta', true],
    ['Clínica de vacinação', 'Vacinar', true],
    [null, 'Petshop Amigo', true],
    ['Loja de carpetes', 'Carpete Bom', false],
    ['Material elétrico', 'Eletro Sul', false],
  ])('%p / %p → %p', (category, name, expected) => {
    expect(isWhatsappHeavySegment(category, name)).toBe(expected);
  });
});
