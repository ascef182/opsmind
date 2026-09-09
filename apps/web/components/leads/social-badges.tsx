import { AtSign, Briefcase, Camera, Link2, MessageCircle, Music2, Share2, Video } from 'lucide-react';
import type { SocialLink, SocialPlatform } from '@/lib/leads/types';

// A versão de `lucide-react` instalada neste repo (^1.40.0) não tem mais os
// ícones de marca (Instagram/Facebook/Linkedin/Youtube/Twitter foram
// removidos do pacote) — checado em node_modules antes de escrever isto.
// Usamos, então, um ícone genérico por plataforma que evoque visualmente o
// tipo de rede, em vez do logo da marca. `OTHER` (e qualquer plataforma
// futura não mapeada) cai no genérico `Link2`.
const PLATFORM_ICONS: Record<SocialPlatform, typeof Link2> = {
  INSTAGRAM: Camera,
  FACEBOOK: Share2,
  LINKEDIN: Briefcase,
  YOUTUBE: Video,
  WHATSAPP: MessageCircle,
  TIKTOK: Music2,
  TWITTER: AtSign,
  OTHER: Link2,
};

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  LINKEDIN: 'LinkedIn',
  YOUTUBE: 'YouTube',
  WHATSAPP: 'WhatsApp',
  TIKTOK: 'TikTok',
  TWITTER: 'Twitter/X',
  OTHER: 'Outro',
};

const MAX_VISIBLE = 3;

// Um ícone por link (limitado aos 3 primeiros + badge "+N"), cada um dentro
// de um link que abre em nova aba. Sem crash e com fallback discreto quando
// `links` é null/vazio — mesmo padrão de `Field`'s `value ?? '—'` em
// [leadId]/page.tsx.
export function SocialBadges({ links }: { links: SocialLink[] | null }) {
  if (!links || links.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const visible = links.slice(0, MAX_VISIBLE);
  const hiddenCount = links.length - visible.length;

  return (
    <span className="inline-flex items-center gap-1.5">
      {visible.map((link, index) => {
        const Icon = PLATFORM_ICONS[link.platform] ?? Link2;
        const label = PLATFORM_LABELS[link.platform] ?? link.platform;
        return (
          <a
            key={`${link.platform}-${index}`}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            title={label}
            aria-label={label}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink-800 text-muted-foreground hover:bg-ink-700 hover:text-foreground"
          >
            <Icon className="h-3.5 w-3.5" />
          </a>
        );
      })}
      {hiddenCount > 0 && (
        <span
          className="inline-flex h-6 items-center justify-center rounded-full bg-ink-800 px-1.5 text-xs font-medium text-muted-foreground"
          title={links
            .slice(MAX_VISIBLE)
            .map((l) => PLATFORM_LABELS[l.platform] ?? l.platform)
            .join(', ')}
        >
          +{hiddenCount}
        </span>
      )}
    </span>
  );
}
