import type { SocialLink, SocialPlatform } from './social-link.types';

// Muitos negócios cadastram no Google Maps uma página de rede social ou de
// "link na bio" no campo de site. Para prospecção isso NÃO é um site: é
// justamente o perfil que mais precisa de um (sem site próprio, sem página
// de serviços, sem formulário). Tratar como site fazia o lead perder os
// pontos de "sem site" e cair como DISQUALIFIED.

const SOCIAL_HOSTS: Record<string, SocialPlatform> = {
  'facebook.com': 'FACEBOOK',
  'fb.com': 'FACEBOOK',
  'fb.me': 'FACEBOOK',
  'instagram.com': 'INSTAGRAM',
  'instagr.am': 'INSTAGRAM',
  // Erro de digitação real visto em dados do Google Maps ("instagran.com/…"):
  // o link não abre site nenhum, e o perfil pretendido é o Instagram.
  'instagran.com': 'INSTAGRAM',
  'wa.me': 'WHATSAPP',
  'wa.link': 'WHATSAPP',
  'whatsapp.com': 'WHATSAPP',
  'api.whatsapp.com': 'WHATSAPP',
  'linkedin.com': 'LINKEDIN',
  'tiktok.com': 'TIKTOK',
  'twitter.com': 'TWITTER',
  'x.com': 'TWITTER',
  'youtube.com': 'YOUTUBE',
  'youtu.be': 'YOUTUBE',
};

// Agregadores de "link na bio": uma lista de links, não um site do negócio.
const LINK_IN_BIO_HOSTS = ['linktr.ee', 'beacons.ai', 'bio.link', 'linkin.bio', 'taplink.cc', 'campsite.bio'];
const LINK_IN_BIO_TLD = '.bio';

export type BusinessWebsiteClassification =
  | { kind: 'website'; url: string }
  | { kind: 'social'; link: SocialLink; whatsappNumber: string | null };

function hostOf(url: string): string | null {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

// Remove subdomínios de idioma/dispositivo ("www.", "m.", "web.", "pt-br.")
// até sobrar um host conhecido.
function matchHost(host: string): SocialPlatform | 'LINK_IN_BIO' | null {
  const labels = host.split('.');
  for (let start = 0; start < labels.length - 1; start++) {
    const candidate = labels.slice(start).join('.');
    if (SOCIAL_HOSTS[candidate]) return SOCIAL_HOSTS[candidate]!;
    if (LINK_IN_BIO_HOSTS.includes(candidate)) return 'LINK_IN_BIO';
  }
  if (host.endsWith(LINK_IN_BIO_TLD)) return 'LINK_IN_BIO';
  return null;
}

function whatsappNumberFrom(url: string): string | null {
  const digits = (value: string | null | undefined) => (value ? value.replace(/\D/g, '') : '');
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    const fromPath = digits(parsed.pathname.split('/').filter(Boolean)[0]);
    const fromQuery = digits(parsed.searchParams.get('phone'));
    const number = fromQuery || fromPath;
    return number.length >= 8 ? number : null;
  } catch {
    return null;
  }
}

/**
 * Classifica o "site" informado por uma fonte estruturada (Google Maps,
 * Explorium). URL que não dá para interpretar continua como site: na dúvida,
 * não inventamos que o negócio não tem site.
 */
export function classifyBusinessWebsite(url: string): BusinessWebsiteClassification {
  const host = hostOf(url.trim());
  const match = host ? matchHost(host) : null;
  if (!match) return { kind: 'website', url };
  const platform: SocialPlatform = match === 'LINK_IN_BIO' ? 'OTHER' : match;
  return {
    kind: 'social',
    link: { platform, url },
    whatsappNumber: platform === 'WHATSAPP' ? whatsappNumberFrom(url) : null,
  };
}
