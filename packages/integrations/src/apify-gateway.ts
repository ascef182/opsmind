import { ApifyClient } from 'apify-client';

/**
 * Parâmetros de busca de negócios locais via Apify (actor de Google Maps).
 */
export interface ApifySearchParams {
  city: string;
  state: string;
  businessType: string;
  limit: number;
}

/**
 * Shape estável usado pelo resto do sistema (`ScrapeJob`/`Lead`) —
 * independente do actor Apify escolhido. Trocar de actor no futuro deve
 * significar só reescrever `mapApifyItemToLead`, nunca mudar este tipo.
 */
export interface ApifyBusinessResult {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  googleCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
  placeId: string | null;
  raw: Record<string, unknown>;
}

export interface ApifyGateway {
  searchBusinesses(params: ApifySearchParams): Promise<ApifyBusinessResult[]>;
}

/**
 * Token de DI para `apps/api` injetar uma implementação de `ApifyGateway`
 * (mesma convenção de `AI_GATEWAY`/`EMBEDDING_GATEWAY` em
 * `apps/api/src/modules/**\/gateway/*.interface.ts`). `apps/worker` nunca usa
 * este token — instancia `ApifyGatewayService` diretamente, sem DI do Nest.
 */
export const APIFY_GATEWAY = Symbol('APIFY_GATEWAY');

/**
 * Implementação via `apify-client` (SDK oficial da Apify, verificado nesta
 * sessão contra os `.d.ts` publicados da versão 2.25.0 — `new
 * ApifyClient({ token })`, `client.actor(id).call(input)` devolve um
 * `ActorRun` com `defaultDatasetId`, e `client.dataset(id).listItems()`
 * resolve pra `{ items, total, ... }`; essa parte do fluxo está confirmada).
 *
 * Classe simples `new`-ável, sem `@Injectable()`/`ConfigService` do Nest —
 * tanto `apps/api` (via o token `APIFY_GATEWAY` acima) quanto `apps/worker`
 * (instanciando direto, sem DI) precisam poder usá-la sem depender um do
 * outro nem do NestJS.
 */
export class ApifyGatewayService implements ApifyGateway {
  constructor(
    private readonly apiToken: string,
    private readonly actorId: string,
  ) {}

  async searchBusinesses(params: ApifySearchParams): Promise<ApifyBusinessResult[]> {
    const client = new ApifyClient({ token: this.apiToken });
    // Formato de input do actor ASSUMIDO (não rodamos o actor de verdade
    // nesta sessão) — `compass/google-maps-extractor` costuma aceitar algo
    // parecido com isto publicamente, mas confirmar contra uma execução real
    // antes de confiar cegamente, no mesmo espírito autocrítico do
    // `CamofoxScrapingClient` do branch `feat/prospecting-outbound`.
    const run = await client.actor(this.actorId).call({
      searchStringsArray: [params.businessType],
      city: params.city,
      state: params.state,
      maxCrawledPlacesPerSearch: params.limit,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return items.map((item) => mapApifyItemToLead(item as Record<string, unknown>));
  }
}

/**
 * Mapeia um item bruto do dataset do actor `compass/google-maps-extractor`
 * (ou qualquer actor equivalente) pro shape estável `ApifyBusinessResult`.
 * Isolada nesta função pra que trocar de actor no futuro toque só aqui.
 *
 * Nomes de campo ASSUMIDOS a partir da documentação pública do actor —
 * `title`→name, `address`→address, `city`, `state`, `phoneUnformatted`→
 * phone, `website`, `categoryName`→googleCategory, `totalScore`→rating,
 * `reviewsCount`→reviewCount, `placeId`. NÃO CONFIRMADOS contra uma
 * execução real do actor nesta sessão — confirmar antes de confiar
 * cegamente. Qualquer campo ausente ou de tipo inesperado vira `null`
 * (exceto `name`, que cai para string vazia — o resto do sistema espera
 * `name: string`, nunca nulo); esta função nunca lança erro por campo
 * faltando.
 */
export function mapApifyItemToLead(item: Record<string, unknown>): ApifyBusinessResult {
  return {
    name: typeof item.title === 'string' ? item.title : '',
    address: typeof item.address === 'string' ? item.address : null,
    city: typeof item.city === 'string' ? item.city : null,
    state: typeof item.state === 'string' ? item.state : null,
    phone: typeof item.phoneUnformatted === 'string' ? item.phoneUnformatted : null,
    website: typeof item.website === 'string' ? item.website : null,
    googleCategory: typeof item.categoryName === 'string' ? item.categoryName : null,
    rating: typeof item.totalScore === 'number' ? item.totalScore : null,
    reviewCount: typeof item.reviewsCount === 'number' ? item.reviewsCount : null,
    placeId: typeof item.placeId === 'string' ? item.placeId : null,
    raw: item,
  };
}
