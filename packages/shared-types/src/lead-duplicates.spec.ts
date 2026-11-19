import { findDuplicatePairs, normalizePhoneForComparison, normalizeWebsiteForComparison } from './lead-duplicates';

describe('normalizeWebsiteForComparison', () => {
  it('ignores protocol, www, trailing slashes, fragment and tracking params', () => {
    const variants = [
      'http://www.Consultare.com.br/',
      'https://consultare.com.br',
      'consultare.com.br//?utm_source=google&utm_medium=cpc',
      'https://consultare.com.br/?gclid=abc#topo',
      'https://consultare.com.br?fbclid=x&srsltid=y',
    ];
    expect(new Set(variants.map(normalizeWebsiteForComparison))).toEqual(new Set(['consultare.com.br']));
  });

  it('keeps params that identify the page', () => {
    expect(normalizeWebsiteForComparison('https://facebook.com/profile.php?id=1&utm_source=x')).toBe('facebook.com/profile.php?id=1');
    expect(normalizeWebsiteForComparison('https://facebook.com/profile.php?id=1')).not.toBe(
      normalizeWebsiteForComparison('https://facebook.com/profile.php?id=2'),
    );
  });

  it('returns null for empty or unparseable values', () => {
    expect(normalizeWebsiteForComparison('')).toBeNull();
    expect(normalizeWebsiteForComparison('not a url')).toBeNull();
  });
});

describe('normalizePhoneForComparison', () => {
  it('compares the last 10 digits, ignoring country code and formatting', () => {
    expect(normalizePhoneForComparison('+55 (18) 3221-6064')).toBe('1832216064');
    expect(normalizePhoneForComparison('18 3221-6064')).toBe('1832216064');
    expect(normalizePhoneForComparison('3221-6064')).toBeNull();
  });
});

describe('findDuplicatePairs', () => {
  const leads = [
    { id: 'b', website: 'https://www.metal.com.br/', phone: null, city: 'Presidente Prudente' },
    { id: 'a', website: 'metal.com.br?utm_source=x', phone: '(18) 3221-6064', city: 'Presidente Prudente' },
    { id: 'c', website: null, phone: '+55 18 3221 6064', city: 'presidente  prudente' },
    { id: 'd', website: null, phone: '18 3221 6064', city: 'Santos' },
  ];

  it('pairs by site and by phone in the same city, always ordered', () => {
    expect(findDuplicatePairs(leads)).toEqual(
      expect.arrayContaining([
        { leadAId: 'a', leadBId: 'b', reasons: ['SAME_WEBSITE'] },
        { leadAId: 'a', leadBId: 'c', reasons: ['SAME_PHONE_CITY'] },
      ]),
    );
    expect(findDuplicatePairs(leads)).toHaveLength(2);
  });

  it('limits to pairs touching the given ids', () => {
    expect(findDuplicatePairs(leads, new Set(['b']))).toEqual([{ leadAId: 'a', leadBId: 'b', reasons: ['SAME_WEBSITE'] }]);
  });
});
