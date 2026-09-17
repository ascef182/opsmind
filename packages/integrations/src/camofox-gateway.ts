import { randomUUID } from 'node:crypto';

/**
 * Parâmetros de busca via camofox-browser (navegador stealth self-hosted,
 * https://github.com/jo-inc/camofox-browser). Macros de busca suportadas
 * pelo serviço são bem mais do que estas três, mas o plano desta feature só
 * usa `@google_search`/`@yelp_search`/`@reddit_search`.
 */
export interface CamofoxSearchParams {
  macro: '@google_search' | '@yelp_search' | '@reddit_search';
  query: string;
  limit: number;
}

export interface CamofoxSearchResult {
  title: string | null;
  url: string;
  textContent: string | null;
  raw: Record<string, unknown>;
}

export interface CamofoxGateway {
  search(params: CamofoxSearchParams): Promise<CamofoxSearchResult[]>;
}

/**
 * Token de DI para `apps/api` injetar uma implementação de `CamofoxGateway`
 * (mesma convenção de `AI_GATEWAY`/`EMBEDDING_GATEWAY`). `apps/worker` nunca
 * usa este token — instancia `CamofoxGatewayService` diretamente.
 */
export const CAMOFOX_GATEWAY = Symbol('CAMOFOX_GATEWAY');

const DEFAULT_USER_ID = 'opsmind-leads';
const DEFAULT_MIN_INTERVAL_MS = 2_000;
// Originalmente 30_000 (mesmo valor default do `CamofoxScrapingClient`
// antigo, branch `feat/prospecting-outbound`) — uma chamada de rede a um
// processo externo (o próprio camofox) nunca pode travar o worker
// indefinidamente se o serviço parar de responder. Subido pra 45_000:
// confirmado ao vivo que `@google_search` sem cookies/histórico
// consistentemente não retorna resultado orgânico do Google e cai no
// fallback automático do camofox-browser pro DuckDuckGo — esse fallback
// sozinho já leva ~31-32s (medido diretamente contra uma instância real),
// estourando os 30s antigos e abortando a navegação bem antes do servidor
// responder com sucesso.
const DEFAULT_TIMEOUT_MS = 45_000;

// Confirmado ao vivo: `POST .../navigate` retorna `navigationOk:true` assim
// que o documento inicial carrega, mas o conteúdo de resultados de busca
// (Google/DuckDuckGo) ainda está sendo renderizado nesse instante — ler
// `GET .../links` imediatamente devolve só o "chrome" da página (nav/rodapé),
// zero resultado. Esperando alguns segundos os resultados aparecem. Duas
// tentativas (RENDER_WAIT_MS cada) em vez de uma esperada mais longa: se a
// página genuinamente não tem resultado (ou já veio populada na primeira
// tentativa), não faz sentido segurar o `search()` até o teto.
const RENDER_WAIT_MS = 2_500;
const RENDER_WAIT_MAX_ATTEMPTS = 2;

// Hosts de motor de busca "genérico" cujo próprio domínio nunca é o destino
// real de um resultado orgânico — confirmado ao vivo que `@google_search`
// cai numa cadeia de fallback google → duckduckgo → bing (camofox-browser
// v1.16.0), e a maior parte dos links de uma página de resultados desses
// motores aponta de volta pro próprio motor (abas "Imagens"/"Notícias",
// filtros, menu, rodapé) em vez de pro site do resultado. Deliberadamente
// NÃO inclui `yelp.com`: pra `@yelp_search` o resultado de verdade (a página
// do negócio) mora no próprio domínio Yelp, então excluir por host quebraria
// esse macro — como isso nunca foi testado ao vivo, `@yelp_search` mantém
// comportamento neutro (aceita qualquer link http(s) absoluto).
const SEARCH_ENGINE_CHROME_HOSTS = new Set(['google.com', 'duckduckgo.com', 'bing.com']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Nunca deve segurar o processo Node vivo sozinho (relevante pro
    // worker, que roda long-lived).
    timer.unref?.();
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Fila interna de rate-limit (concurrency=1 + intervalo mínimo configurável
 * entre chamadas) — reaproveitada quase verbatim de `CallQueue` em
 * `CamofoxScrapingClient`, `apps/api/src/infrastructure/scraping/
 * camofox-scraping.client.ts` no branch `feat/prospecting-outbound`
 * (não mergeado). Essa parte do client antigo estava correta e evita
 * disparar dezenas de chamadas quase simultâneas contra o navegador
 * compartilhado do camofox (risco de bloqueio/ban) quando um `ScrapeJob`
 * com `limit` alto gera muitas buscas em sequência — só a lógica de
 * requisição HTTP do client antigo foi refeita (ver comentário da classe
 * `CamofoxGatewayService` abaixo).
 */
class CallQueue {
  private tail: Promise<void> = Promise.resolve();
  private lastCallEndedAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const elapsed = Date.now() - this.lastCallEndedAt;
      const wait = this.minIntervalMs - elapsed;
      if (this.lastCallEndedAt > 0 && wait > 0) {
        await sleep(wait);
      }
      try {
        return await fn();
      } finally {
        this.lastCallEndedAt = Date.now();
      }
    });
    // A cauda da fila nunca deve "quebrar" por causa de uma chamada que
    // falhou — cada chamador recebe sua própria promise (`run`) com o
    // resultado/erro real; a fila só precisa saber "quando terminou".
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/**
 * Implementação de `CamofoxGateway` via camofox-browser
 * (https://github.com/jo-inc/camofox-browser, servidor REST próprio, porta
 * padrão 9377).
 *
 * ENDPOINTS/PAYLOADS abaixo, confirmados ao vivo contra uma instância real
 * (v1.16.0, rodando nativo fora do Docker — ver `infra/docker/README.md`
 * pro porquê):
 *   - `POST {baseUrl}/tabs` com `{ userId, sessionKey }` (SEM `url` — ver
 *     comentário em `createTab`) → cria uma tab, resposta inclui `tabId`.
 *   - `POST {baseUrl}/tabs/:id/navigate` com `{ userId, macro, query }` →
 *     navega/roda a macro de busca. Pode cair num motor de busca diferente
 *     do pedido (ex.: `@google_search` caindo pra DuckDuckGo — resposta traz
 *     `searchEngine`/`fallbackFrom` quando isso acontece).
 *   - `GET {baseUrl}/tabs/:id/links?userId=...` → lista `{ url, text }[]` já
 *     com URLs absolutas resolvidas — usado pra extrair resultado de busca
 *     (ver `getLinks`/`SEARCH_ENGINE_CHROME_HOSTS` abaixo). Muito mais
 *     confiável que fazer parsing manual do texto do snapshot de
 *     acessibilidade (abordagem antiga, nunca funcionava de verdade — ver
 *     histórico do arquivo).
 *   - `DELETE {baseUrl}/tabs/:id?userId=...` → fecha a tab, SEMPRE (inclusive
 *     em erro, via try/finally).
 *   - `Authorization: Bearer {accessKey}` em todo request quando `accessKey`
 *     estiver setado (`CAMOFOX_ACCESS_KEY`).
 * Isto corrige a lógica de requisição do `CamofoxScrapingClient` do branch
 * antigo (que tinha suposições furadas sobre esse fluxo) — só o `CallQueue`
 * dele foi reaproveitado (ver acima).
 *
 * O invariante "nunca fabricar `url: ''`" (ver docstring de `toStructuredResult`)
 * vale tanto no path estruturado (Reddit, via `extractItemsArray` a partir da
 * própria resposta do `navigate`) quanto no path via `/links` (Google/Yelp):
 * um item sem URL reconhecível é descartado, nunca vira um resultado com URL
 * vazia — `CamofoxSearchResult.url` é `string` não-opcional porque quem
 * consome isso (criação de lead, dedup por URL, links na UI) trata o campo
 * como uma URL real e usável.
 *
 * RESSALVA AINDA NÃO VERIFICADA AO VIVO: macros de Reddit — o path
 * estruturado (`extractItemsArray`/`toStructuredResult` a partir da resposta
 * do `navigate`) nunca foi exercitado contra `@reddit_search` de verdade.
 * Confirmar antes de habilitar essa fonte em produção.
 *
 * Classe simples `new`-ável, sem `@Injectable()`/`ConfigService` do Nest —
 * mesmo racional de `ApifyGatewayService`.
 */
export class CamofoxGatewayService implements CamofoxGateway {
  private readonly rateLimiter: CallQueue;

  constructor(
    private readonly baseUrl: string,
    private readonly accessKey?: string,
    minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly renderWaitMs: number = RENDER_WAIT_MS,
  ) {
    this.rateLimiter = new CallQueue(minIntervalMs);
  }

  async search(params: CamofoxSearchParams): Promise<CamofoxSearchResult[]> {
    return this.rateLimiter.schedule(() => this.doSearch(params));
  }

  private async doSearch(params: CamofoxSearchParams): Promise<CamofoxSearchResult[]> {
    const tabId = await this.createTab();
    try {
      const navigateResponse = await this.navigate(tabId, params);
      const fromNavigate = parseCamofoxResults(navigateResponse, params.limit);
      if (fromNavigate.length > 0) {
        return fromNavigate;
      }
      return await this.searchLinksWithRetry(tabId, params.limit);
    } finally {
      await this.closeTabSafely(tabId);
    }
  }

  private async searchLinksWithRetry(tabId: string, limit: number): Promise<CamofoxSearchResult[]> {
    let results: CamofoxSearchResult[] = [];
    for (let attempt = 0; attempt < RENDER_WAIT_MAX_ATTEMPTS; attempt++) {
      await sleep(this.renderWaitMs);
      const links = await this.getLinks(tabId);
      results = toLinkResults(links, limit);
      if (results.length > 0) {
        break;
      }
    }
    return results;
  }

  private async createTab(): Promise<string> {
    // `url` é opcional no schema real de `POST /tabs` (cria a tab em
    // about:blank de qualquer forma quando omitido) — NUNCA mandar
    // `url: 'about:blank'` explicitamente: confirmado ao vivo contra uma
    // instância real do camofox-browser (v1.16.0) que o servidor rejeita
    // com 400 ("Blocked URL scheme: about: — only http/https allowed") um
    // valor de `url` que não seja http/https, mesmo sendo "about:blank".
    const body = (await this.request('POST', '/tabs', {
      userId: DEFAULT_USER_ID,
      sessionKey: randomUUID(),
    })) as { id?: string; tabId?: string } | null;
    const tabId = body?.id ?? body?.tabId;
    if (!tabId) {
      throw new Error('camofox: resposta inesperada ao criar tab (campo "id" ausente).');
    }
    return tabId;
  }

  private async navigate(tabId: string, params: CamofoxSearchParams): Promise<unknown> {
    return this.request('POST', `/tabs/${tabId}/navigate`, {
      userId: DEFAULT_USER_ID,
      macro: params.macro,
      query: params.query,
    });
  }

  // `userId` é query param obrigatório em GET .../links — confirmado ao vivo
  // (400 sem ele, mesmo padrão de `.../snapshot`/DELETE). A doc pública do
  // OpenAPI do projeto nomeia o campo do href como `href`, mas a resposta
  // real da instância usa `url` — confiamos no que foi observado ao vivo,
  // não na doc (aceitamos os dois defensivamente por segurança).
  private async getLinks(tabId: string): Promise<CamofoxLink[]> {
    const body = (await this.request(
      'GET',
      `/tabs/${tabId}/links?userId=${encodeURIComponent(DEFAULT_USER_ID)}`,
    )) as { links?: unknown } | null;
    if (!Array.isArray(body?.links)) {
      return [];
    }
    return (body.links as Record<string, unknown>[])
      .map((item) => {
        const url = item.url ?? item.href;
        const text = item.text;
        return typeof url === 'string' && url.length > 0
          ? { url, text: typeof text === 'string' ? text : '' }
          : null;
      })
      .filter((link): link is CamofoxLink => link !== null);
  }

  private async closeTabSafely(tabId: string): Promise<void> {
    try {
      // `userId` é query param obrigatório em DELETE .../tabs/:id também —
      // confirmado ao vivo (400 sem ele). Antes desse fix o DELETE sempre
      // falhava silenciosamente (try/catch abaixo) e nenhuma tab era
      // realmente fechada — só expirava sozinha pelo idle-timeout do
      // camofox.
      await this.request('DELETE', `/tabs/${tabId}?userId=${encodeURIComponent(DEFAULT_USER_ID)}`);
    } catch {
      // Nunca deixa falha ao fechar a tab mascarar o resultado (ou erro)
      // real da busca — o camofox eventualmente expira tabs órfãs sozinho.
    }
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.accessKey) {
      headers.Authorization = `Bearer ${this.accessKey}`;
    }
    // `AbortController` + timeout em toda chamada — sem isso, uma instância
    // do camofox travada (processo externo, fora do nosso controle) travaria
    // o job/request chamador para sempre. Mesma abordagem do
    // `CamofoxScrapingClient` antigo (branch `feat/prospecting-outbound`),
    // que tinha esse cuidado exatamente por isso.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `camofox respondeu ${response.status} ${response.statusText} para ${method} ${path}`,
        );
      }
      if (response.status === 204) {
        return null;
      }
      return await response.json().catch(() => null);
    } catch (err) {
      if (isAbortError(err)) {
        throw new Error(`camofox: timeout (${this.timeoutMs}ms) ao chamar ${method} ${path}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Extrai `CamofoxSearchResult[]` de uma resposta estruturada (array direto,
 * ou `{ results | items | posts: [...] }`) — formato usado por macros de
 * Reddit na própria resposta do `POST .../navigate` (ver ressalva no
 * comentário da classe). Nunca lança erro por formato inesperado — na pior
 * hipótese devolve `[]`.
 */
function parseCamofoxResults(raw: unknown, limit: number): CamofoxSearchResult[] {
  const items = extractItemsArray(raw);
  if (!items) {
    return [];
  }
  const results: CamofoxSearchResult[] = [];
  for (const item of items) {
    if (results.length >= limit) {
      break;
    }
    const result = toStructuredResult(item);
    if (result) {
      results.push(result);
    }
  }
  return results;
}

function extractItemsArray(raw: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(raw)) {
    return raw as Record<string, unknown>[];
  }
  if (raw && typeof raw === 'object') {
    const candidate =
      (raw as Record<string, unknown>).results ??
      (raw as Record<string, unknown>).items ??
      (raw as Record<string, unknown>).posts;
    if (Array.isArray(candidate)) {
      return candidate as Record<string, unknown>[];
    }
  }
  return null;
}

interface CamofoxLink {
  url: string;
  text: string;
}

function isUsefulResultLink(link: CamofoxLink): boolean {
  let parsed: URL;
  try {
    parsed = new URL(link.url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  return !SEARCH_ENGINE_CHROME_HOSTS.has(host);
}

/**
 * Converte os links de `GET .../links` em `CamofoxSearchResult[]`, filtrando
 * links de "chrome" do próprio motor de busca (ver `SEARCH_ENGINE_CHROME_HOSTS`).
 * Mesma disciplina de `toStructuredResult`: nunca fabrica `url: ''` — os
 * links já vêm com URL absoluta resolvida pelo próprio camofox-browser, então
 * aqui só filtramos, não inventamos nada.
 */
function toLinkResults(links: CamofoxLink[], limit: number): CamofoxSearchResult[] {
  const results: CamofoxSearchResult[] = [];
  for (const link of links) {
    if (results.length >= limit) {
      break;
    }
    if (!isUsefulResultLink(link)) {
      continue;
    }
    results.push({
      title: link.text || null,
      url: link.url,
      textContent: null,
      raw: { ...link },
    });
  }
  return results;
}

// Reddit-style APIs (o formato que motivou o path estruturado, ver ressalva 2
// no comentário da classe) tipicamente expõem `permalink` como um PATH
// relativo ao site (ex.: "/r/subreddit/comments/abc123/titulo/"), não uma URL
// absoluta — resolvemos contra `https://www.reddit.com` quando não já vier
// como `http(s)://`. Um `permalink` absoluto (formato incomum, mas possível)
// é usado como está.
function resolveStructuredUrl(item: Record<string, unknown>): string | null {
  if (typeof item.url === 'string' && item.url.length > 0) {
    return item.url;
  }
  if (typeof item.postUrl === 'string' && item.postUrl.length > 0) {
    return item.postUrl;
  }
  if (typeof item.permalink === 'string' && item.permalink.length > 0) {
    return item.permalink.startsWith('http')
      ? item.permalink
      : `https://www.reddit.com${item.permalink.startsWith('/') ? '' : '/'}${item.permalink}`;
  }
  return null;
}

/**
 * Mesma disciplina de `parseAccessibilityTreeLinks`: `CamofoxSearchResult.url`
 * é `string` não-opcional porque quem consome isso (criação de lead, dedup
 * por URL, links na UI) trata o campo como uma URL real e usável — NUNCA
 * fabricamos `url: ''`. Quando nenhum campo de URL reconhecível existe no
 * item (`url`/`postUrl`/`permalink`), a entrada é descartada (`null`) em vez
 * de virar um `CamofoxSearchResult` com URL vazia — ver `parseCamofoxResults`,
 * que filtra os `null`s.
 */
function toStructuredResult(item: Record<string, unknown>): CamofoxSearchResult | null {
  const url = resolveStructuredUrl(item);
  if (!url) {
    return null;
  }
  return {
    title: typeof item.title === 'string' ? item.title : null,
    url,
    textContent:
      typeof item.textContent === 'string'
        ? item.textContent
        : typeof item.bodyText === 'string'
          ? item.bodyText
          : typeof item.selftext === 'string'
            ? item.selftext
            : null,
    raw: item,
  };
}
