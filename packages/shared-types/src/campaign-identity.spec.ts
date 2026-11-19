import { CAMPAIGN_LIFECYCLE, campaignDisplayName, campaignIdentityKey, foldIdentityText } from './campaign-identity';

describe('campaignIdentityKey', () => {
  it('ignores case, accents, extra spaces and full state names', () => {
    expect(campaignIdentityKey('Imobiliária', 'São Paulo', 'SP')).toBe('imobiliaria|sao paulo|sp');
    expect(campaignIdentityKey('  imobiliaria ', 'sao  paulo', 'São Paulo')).toBe('imobiliaria|sao paulo|sp');
    expect(campaignIdentityKey('Metalúrgica', 'Presidente Prudente', 'Estado de São Paulo')).toBe(
      'metalurgica|presidente prudente|sp',
    );
  });

  it('keeps plurals apart (decision C3)', () => {
    expect(campaignIdentityKey('Barbearia', 'São Paulo', 'SP')).not.toBe(campaignIdentityKey('Barbearias', 'São Paulo', 'SP'));
  });

  it('matches the SQL fold used by the migration for Portuguese characters', () => {
    expect(foldIdentityText('ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ')).toBe('aaaaaeeeeiiiiooooouuuucn');
  });
});

describe('campaignDisplayName', () => {
  it('uses the state code', () => {
    expect(campaignDisplayName('Metalúrgicas', 'Presidente Prudente', 'São Paulo')).toBe('Metalúrgicas — Presidente Prudente/SP');
  });
});

describe('CAMPAIGN_LIFECYCLE', () => {
  it('never reopens an archived campaign', () => {
    for (const rule of Object.values(CAMPAIGN_LIFECYCLE)) expect(rule.from).not.toContain('ARCHIVED');
  });
});
