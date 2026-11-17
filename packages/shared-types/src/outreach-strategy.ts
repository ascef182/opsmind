import { classifyBusinessWebsite } from './business-website';

// Abordagem comercial do primeiro contato, decidida por regra a partir do que
// a pesquisa realmente encontrou. O modelo de IA nunca escolhe a abordagem:
// ele só escreve dentro dela, o que impede vender site para quem já tem um
// bom e DeskComm para quem não deu sinal de atender pelo WhatsApp.
export const OUTREACH_STRATEGIES = [
  'NO_WEBSITE',
  'OUTDATED_WEBSITE',
  'WEAK_CONVERSION',
  'WHATSAPP_AUTOMATION',
  'STRONG_PRESENCE',
  'GENERAL',
] as const;

export type OutreachStrategy = (typeof OUTREACH_STRATEGIES)[number];

export const OUTREACH_STRATEGY_LABELS: Record<OutreachStrategy, string> = {
  NO_WEBSITE: 'Sem site',
  OUTDATED_WEBSITE: 'Site desatualizado',
  WEAK_CONVERSION: 'Conversão fraca',
  WHATSAPP_AUTOMATION: 'Automação de WhatsApp',
  STRONG_PRESENCE: 'Presença forte',
  GENERAL: 'Geral',
};

// Segmentos em que o cliente final costuma agendar e tirar dúvida pelo
// WhatsApp. Para eles, sem site mas com WhatsApp conhecido, o DeskComm é a
// oferta de maior encaixe; para os demais (indústria, serviços B2B), o site.
export const WHATSAPP_HEAVY_SEGMENTS: readonly string[] = [
  'academia',
  'gym',
  'fitness',
  'crossfit',
  'pilates',
  'artes marciais',
  'martial',
  'jiu',
  'muay',
  'boxe',
  'luta',
  'estetica',
  'beleza',
  'beauty',
  'salao',
  'salon',
  'barbearia',
  'barber',
  'manicure',
  'clinica',
  'clinic',
  'odonto',
  'dentist',
  'dental',
  'psicolog',
  'fisioterap',
  'nutricion',
  'pet',
  'veterin',
];

const OUTDATED_SIGNALS = ['website.outdated_copyright_year', 'website.no_ssl', 'website.no_mobile_viewport'];
const WEAK_CONVERSION_SIGNALS = ['website.no_contact_form'];
const WHATSAPP_SIGNAL = 'social.has_whatsapp_link';

const SIGNAL_REASONS: Record<string, string> = {
  'website.outdated_copyright_year': 'o rodapé do site traz um ano de copyright antigo',
  'website.no_ssl': 'o site não abre com HTTPS',
  'website.no_mobile_viewport': 'o site não está configurado para celular',
  'website.no_contact_form': 'não encontramos formulário de contato no site',
};

export interface OutreachStrategyInput {
  website: string | null;
  // `null` quando o site nunca foi investigado; lista vazia quando foi e
  // nada de relevante apareceu.
  signalCodes: string[] | null;
  whatsappKnown: boolean;
  category: string | null;
  name: string;
}

export interface OutreachStrategyDecision {
  strategy: OutreachStrategy;
  reasons: string[];
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function isWhatsappHeavySegment(category: string | null, name: string): boolean {
  // Casa no início da palavra: "pet" pega "petshop", não "carpete".
  const haystack = normalize(`${category ?? ''} ${name}`);
  return WHATSAPP_HEAVY_SEGMENTS.some((keyword) => new RegExp(`\\b${keyword}`).test(haystack));
}

export function selectOutreachStrategy(input: OutreachStrategyInput): OutreachStrategyDecision {
  const hasWebsite = input.website ? classifyBusinessWebsite(input.website).kind === 'website' : false;

  if (!hasWebsite) {
    if (input.whatsappKnown && isWhatsappHeavySegment(input.category, input.name)) {
      return {
        strategy: 'WHATSAPP_AUTOMATION',
        reasons: [
          'não localizamos um site próprio na pesquisa',
          'o negócio divulga um WhatsApp de contato',
          'no segmento dele o cliente costuma agendar e tirar dúvidas pelo WhatsApp',
        ],
      };
    }
    return { strategy: 'NO_WEBSITE', reasons: ['não localizamos um site próprio na pesquisa'] };
  }

  if (input.signalCodes === null) {
    return { strategy: 'GENERAL', reasons: ['o site ainda não foi analisado'] };
  }

  const codes = new Set(input.signalCodes);
  const outdated = OUTDATED_SIGNALS.filter((code) => codes.has(code));
  if (outdated.length > 0) {
    return { strategy: 'OUTDATED_WEBSITE', reasons: outdated.map((code) => SIGNAL_REASONS[code]!) };
  }

  const weak = WEAK_CONVERSION_SIGNALS.filter((code) => codes.has(code));
  if (weak.length > 0) {
    return { strategy: 'WEAK_CONVERSION', reasons: weak.map((code) => SIGNAL_REASONS[code]!) };
  }

  if (input.whatsappKnown || codes.has(WHATSAPP_SIGNAL)) {
    return {
      strategy: 'WHATSAPP_AUTOMATION',
      reasons: ['o site está em boa forma', 'o negócio atende pelo WhatsApp'],
    };
  }

  return {
    strategy: 'STRONG_PRESENCE',
    reasons: ['o site não mostrou problemas nos pontos que analisamos'],
  };
}

export type OfferingKind = 'WEBSITE' | 'WHATSAPP_AUTOMATION' | 'CUSTOM_APP' | 'OTHER';

// Tipo de oferta que resolve cada abordagem. `null`: não há oferta óbvia e
// vale a oferta já sugerida pelo scoring.
export const STRATEGY_OFFERING_KIND: Record<OutreachStrategy, OfferingKind | null> = {
  NO_WEBSITE: 'WEBSITE',
  OUTDATED_WEBSITE: 'WEBSITE',
  WEAK_CONVERSION: 'WEBSITE',
  WHATSAPP_AUTOMATION: 'WHATSAPP_AUTOMATION',
  STRONG_PRESENCE: null,
  GENERAL: null,
};
