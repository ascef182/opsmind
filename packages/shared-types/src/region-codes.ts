// O Google Maps (via Apify) devolve o estado por extenso ("São Paulo",
// "State of São Paulo", "Texas"), enquanto buscas, filtros e o dedup por
// nome+cidade+estado usam a sigla ("SP", "TX"). Esta tabela converte para a
// sigla; valor desconhecido volta como veio, nunca vira null.

const BR_STATES: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'federal district': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

const US_STATES: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(state of|estado de|estado do|estado da)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sigla do estado a partir do nome por extenso. `countryCode` (ISO 3166-1,
 * ex.: "BR", "US") desempata nomes iguais nos dois países; sem ele, tenta
 * Brasil e depois EUA. Sigla já válida passa direto (em maiúsculas).
 */
export function normalizeRegionCode(state: string | null, countryCode?: string | null): string | null {
  if (state === null) return null;
  const trimmed = state.trim();
  if (trimmed === '') return null;
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();

  const key = fold(trimmed);
  const country = countryCode?.toUpperCase();
  const tables = country === 'US' ? [US_STATES] : country === 'BR' ? [BR_STATES] : [BR_STATES, US_STATES];
  for (const table of tables) {
    const code = table[key];
    if (code) return code;
  }
  return trimmed;
}
