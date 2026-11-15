import { ApifyClient } from 'apify-client';
import type { SocialLink, SocialPlatform } from '@opsmind/shared-types';

/**
 * Descoberta de contato/redes (Task 9) via dois Actors da Apify, ambos
 * standalone e DIFERENTES dos add-ons pagos de enrichment do actor de
 * Google Maps (`business leads enrichment`, `email verification`, `social
 * media profile enrichment`, ~US$0,10/lead cada — ver aviso em
 * `apps/worker/src/lead-scrape-processor.ts`, `SCRAPING_COST_PER_LEAD_USD`).
 * Esses add-ons NUNCA devem ser chamados pelo pipeline automático; os actors
 * usados aqui (`vdrmota/contact-info-scraper` e
 * `apify/instagram-profile-scraper`, ids configuráveis por env var — ver
 * `packages/config/env/schema.ts`) são integrações separadas e o plano Free
 * da Apify os inclui.
 *
 * MESMO AVISO DE `apify-gateway.ts` (Google Maps extractor) E
 * `explorium-gateway.ts` (contrato REST): o mapeamento de campo do dataset
 * de cada actor pro shape estável abaixo é ASSUMIDO a partir da
 * documentação pública de cada um — NENHUM dos dois actors foi de fato
 * executado nesta sessão. Confirmar contra uma execução real antes de
 * confiar cegamente:
 *   - `vdrmota/contact-info-scraper`: input assumido
 *     `{ startUrls: [{ url }], maxDepth: 1 }`; cada item do dataset assumido
 *     como tendo arrays `emails`/`phones`/`linkedIns`/`twitters`/
 *     `instagrams`/`facebooks`/`youtubes`/`whatsapps` (strings) — este
 *     último (`whatsapps`, links de clique-para-conversar tipo `wa.me`
 *     encontrados na página) é o sinal usado para "telefone reconhecível
 *     como WhatsApp Business" no passo do worker; se o actor real não tiver
 *     esse campo, `mapContactItems` simplesmente não encontra nada nele
 *     (nunca lança).
 *   - `apify/instagram-profile-scraper`: input assumido
 *     `{ usernames: [handle] }`; item do dataset assumido como tendo
 *     `biography`/`externalUrl`/`businessEmail` (nomes comuns em actors de
 *     perfil do Instagram da Apify) — `whatsappLink` é extraído procurando
 *     um padrão `wa.me`/`api.whatsapp.com` tanto em `externalUrl` quanto em
 *     `biography` (é comum o link estar só no texto da bio).
 *
 * Classe simples `new`-ável, sem `@Injectable()`/`ConfigService` do Nest —
 * mesmo racional de `ApifyGatewayService`/`ExploriumGatewayService`.
 */
export interface ContactScrapeResult {
  emails: string[];
  phones: string[];
  socials: SocialLink[];
}

export interface InstagramProfileResult {
  bio: string | null;
  whatsappLink: string | null;
  email: string | null;
}

export interface ContactEnrichmentGateway {
  scrapeContactInfo(url: string): Promise<ContactScrapeResult>;
  lookupInstagramProfile(handle: string): Promise<InstagramProfileResult | null>;
}

/**
 * Token de DI para `apps/api` injetar uma implementação de
 * `ContactEnrichmentGateway` (mesma convenção de `APIFY_GATEWAY`/
 * `EXPLORIUM_GATEWAY`/`CAMOFOX_GATEWAY`). `apps/worker` nunca usa este
 * token — instancia `ContactEnrichmentGatewayService` diretamente.
 */
export const CONTACT_ENRICHMENT_GATEWAY = Symbol('CONTACT_ENRICHMENT_GATEWAY');

export class ContactEnrichmentGatewayService implements ContactEnrichmentGateway {
  constructor(
    private readonly apiToken: string,
    private readonly contactEnrichmentActorId: string,
    private readonly instagramProfileActorId: string,
  ) {}

  async scrapeContactInfo(url: string): Promise<ContactScrapeResult> {
    const client = new ApifyClient({ token: this.apiToken });
    // Formato de input ASSUMIDO — ver aviso no topo do arquivo.
    const run = await client.actor(this.contactEnrichmentActorId).call({
      startUrls: [{ url }],
      maxDepth: 1,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return mergeContactItems(items as Record<string, unknown>[]);
  }

  async lookupInstagramProfile(handle: string): Promise<InstagramProfileResult | null> {
    const client = new ApifyClient({ token: this.apiToken });
    const run = await client.actor(this.instagramProfileActorId).call({
      // Formato de input ASSUMIDO — ver aviso no topo do arquivo.
      usernames: [normalizeInstagramHandle(handle)],
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const [item] = items;
    if (!item) {
      return null;
    }
    return mapInstagramItem(item as Record<string, unknown>);
  }
}

/**
 * Remove "@" e resolve uma URL completa de perfil (`https://instagram.com/x`)
 * pro handle cru (`x`) — o actor de perfil espera só o username.
 */
function normalizeInstagramHandle(handle: string): string {
  const trimmed = handle.trim().replace(/^@/, '');
  const urlMatch = trimmed.match(/instagram\.com\/([^/?#]+)/i);
  return urlMatch?.[1] ?? trimmed;
}

const SOCIAL_ARRAY_FIELDS: Array<{ field: string; platform: SocialPlatform }> = [
  { field: 'instagrams', platform: 'INSTAGRAM' },
  { field: 'facebooks', platform: 'FACEBOOK' },
  { field: 'linkedIns', platform: 'LINKEDIN' },
  { field: 'twitters', platform: 'TWITTER' },
  { field: 'youtubes', platform: 'YOUTUBE' },
  // Ver aviso no topo do arquivo — campo `whatsapps` ASSUMIDO, é o sinal de
  // "telefone reconhecível como WhatsApp Business" que o worker usa.
  { field: 'whatsapps', platform: 'WHATSAPP' },
];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * Mapeia UM item bruto do dataset do `vdrmota/contact-info-scraper` pro
 * shape estável `ContactScrapeResult`. Isolada nesta função pra que trocar
 * de actor no futuro toque só aqui — nunca lança por campo ausente/tipo
 * inesperado (arrays ausentes viram `[]`).
 */
export function mapContactItem(item: Record<string, unknown>): ContactScrapeResult {
  const socials: SocialLink[] = [];
  for (const { field, platform } of SOCIAL_ARRAY_FIELDS) {
    for (const url of toStringArray(item[field])) {
      socials.push({ platform, url });
    }
  }
  return {
    emails: toStringArray(item.emails),
    phones: toStringArray(item.phones),
    socials,
  };
}

/**
 * `startUrls`/`maxDepth` podem gerar mais de um item no dataset (uma página
 * por item) — junta tudo num único `ContactScrapeResult`, deduplicando
 * emails/telefones/socials (por platform+url) pra não repetir o mesmo dado
 * achado em páginas diferentes do mesmo site.
 */
export function mergeContactItems(items: Record<string, unknown>[]): ContactScrapeResult {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const socialsSeen = new Set<string>();
  const socials: SocialLink[] = [];

  for (const item of items) {
    const mapped = mapContactItem(item);
    mapped.emails.forEach((e) => emails.add(e));
    mapped.phones.forEach((p) => phones.add(p));
    for (const social of mapped.socials) {
      const key = `${social.platform}:${social.url}`;
      if (!socialsSeen.has(key)) {
        socialsSeen.add(key);
        socials.push(social);
      }
    }
  }

  return { emails: [...emails], phones: [...phones], socials };
}

const WHATSAPP_LINK_PATTERN = /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/\S+/i;

/**
 * Mapeia UM item bruto do dataset do `apify/instagram-profile-scraper` pro
 * shape estável `InstagramProfileResult` — nomes de campo ASSUMIDOS, ver
 * aviso no topo do arquivo. `whatsappLink` é procurado tanto em
 * `externalUrl` quanto no texto de `biography` (comum o link só aparecer na
 * bio); nunca lança por campo ausente.
 */
export function mapInstagramItem(item: Record<string, unknown>): InstagramProfileResult {
  const biography = typeof item.biography === 'string' ? item.biography : null;
  const externalUrl = typeof item.externalUrl === 'string' ? item.externalUrl : null;
  const email =
    typeof item.businessEmail === 'string'
      ? item.businessEmail
      : typeof item.publicEmail === 'string'
        ? item.publicEmail
        : null;

  const whatsappLink =
    (externalUrl && WHATSAPP_LINK_PATTERN.exec(externalUrl)?.[0]) ||
    (biography && WHATSAPP_LINK_PATTERN.exec(biography)?.[0]) ||
    null;

  return { bio: biography, whatsappLink, email };
}
