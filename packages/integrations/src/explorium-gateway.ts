/**
 * Parâmetros de busca de negócios via Explorium (a mesma API B2B por trás
 * das tools MCP "Vibe Prospecting" — busca+enrichment com firmografia).
 */
export interface ExploriumSearchParams {
  city: string;
  state: string;
  businessType: string;
  onlyWithoutWebsite: boolean;
  limit: number;
}

export interface ExploriumBusinessResult {
  name: string;
  website: string | null;
  industry: string | null;
  employeeCount: number | null;
  revenueUsd: number | null;
  matchConfidence: number;
  raw: Record<string, unknown>;
}

export interface ExploriumGateway {
  searchBusinesses(params: ExploriumSearchParams): Promise<ExploriumBusinessResult[]>;
  matchBusiness(
    name: string,
    address: string | null,
    website: string | null,
  ): Promise<ExploriumBusinessResult | null>;
}

/**
 * Token de DI para `apps/api` injetar uma implementação de `ExploriumGateway`
 * (mesma convenção de `AI_GATEWAY`/`EMBEDDING_GATEWAY`). `apps/worker` nunca
 * usa este token — instancia `ExploriumGatewayService` diretamente.
 */
export const EXPLORIUM_GATEWAY = Symbol('EXPLORIUM_GATEWAY');

// ============================================================================
// ATENÇÃO — NÃO VERIFICADO NESTA SESSÃO.
//
// O contrato exato da REST API da Explorium (base URL, header de
// autenticação, shape de request/response de busca e de match) NÃO foi
// confirmado contra uma conta real nesta sessão. Foi inferido a partir do
// comportamento das ferramentas MCP "Vibe Prospecting" (que usam a mesma API
// por trás), mas essas tools não são chamáveis a partir do backend em
// produção — não dá pra "espiar" a requisição HTTP real que elas fazem.
//
// O shape abaixo (`POST /v1/businesses/search`, `POST
// /v1/businesses/match`, header `Authorization: Bearer`) é o mais plausível
// dado o padrão comum de APIs B2B semelhantes, mas é só um palpite
// educado — está isolado nesta constante e nos métodos `request()`/
// `mapExploriumItem()` propositalmente, pra ser fácil de corrigir assim que
// alguém confirmar contra uma conta real. NÃO trate esta implementação como
// uma integração testada — ela nunca rodou contra a Explorium de verdade.
// ============================================================================
const EXPLORIUM_API_BASE_URL = 'https://api.explorium.ai/v1';

/**
 * Implementação via `fetch` cru (sem SDK — a Explorium não publica um client
 * npm oficial conhecido) contra a REST API da Explorium. Ver aviso acima
 * sobre o contrato não verificado.
 *
 * Classe simples `new`-ável, sem `@Injectable()` do Nest — mesmo racional de
 * `ApifyGatewayService`.
 */
export class ExploriumGatewayService implements ExploriumGateway {
  constructor(private readonly apiKey: string) {}

  async searchBusinesses(params: ExploriumSearchParams): Promise<ExploriumBusinessResult[]> {
    const body: Record<string, unknown> = {
      city: params.city,
      region: params.state,
      business_type: params.businessType,
      limit: params.limit,
    };
    if (params.onlyWithoutWebsite) {
      body.has_website = false;
    }
    const data = await this.request('/businesses/search', body);
    return extractItemsArray(data).map(mapExploriumItem);
  }

  async matchBusiness(
    name: string,
    address: string | null,
    website: string | null,
  ): Promise<ExploriumBusinessResult | null> {
    const body: Record<string, unknown> = { name };
    if (address) {
      body.address = address;
    }
    if (website) {
      body.website = website;
    }
    const data = await this.request('/businesses/match', body);
    const match = extractSingleMatch(data);
    return match ? mapExploriumItem(match) : null;
  }

  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${EXPLORIUM_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header de auth ASSUMIDO — ver aviso no topo do arquivo.
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `Explorium API respondeu ${response.status} ${response.statusText} para POST ${path}`,
      );
    }
    return response.json().catch(() => null);
  }
}

function extractItemsArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data as Record<string, unknown>[];
  }
  if (data && typeof data === 'object') {
    const candidate =
      (data as Record<string, unknown>).businesses ?? (data as Record<string, unknown>).results;
    if (Array.isArray(candidate)) {
      return candidate as Record<string, unknown>[];
    }
  }
  return [];
}

function extractSingleMatch(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.matches) && obj.matches.length > 0) {
    return obj.matches[0] as Record<string, unknown>;
  }
  if (obj.business && typeof obj.business === 'object') {
    return obj.business as Record<string, unknown>;
  }
  // Talvez a API devolva o próprio objeto de negócio no topo da resposta.
  return typeof obj.name === 'string' ? obj : null;
}

/**
 * Mapeia um item bruto (busca ou match) pro shape estável
 * `ExploriumBusinessResult`. Nomes de campo (`employee_count`,
 * `revenue_usd`, `match_confidence`) também ASSUMIDOS — ver aviso no topo do
 * arquivo. Qualquer campo ausente ou de tipo inesperado vira `null` (ou `0`
 * pra `matchConfidence`, que não é nullable); nunca lança erro por campo
 * faltando.
 */
function mapExploriumItem(item: Record<string, unknown>): ExploriumBusinessResult {
  return {
    name: typeof item.name === 'string' ? item.name : '',
    website: typeof item.website === 'string' ? item.website : null,
    industry: typeof item.industry === 'string' ? item.industry : null,
    employeeCount: typeof item.employee_count === 'number' ? item.employee_count : null,
    revenueUsd: typeof item.revenue_usd === 'number' ? item.revenue_usd : null,
    matchConfidence: typeof item.match_confidence === 'number' ? item.match_confidence : 0,
    raw: item,
  };
}
