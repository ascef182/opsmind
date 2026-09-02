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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Nunca deve segurar o processo Node vivo sozinho (relevante pro
    // worker, que roda long-lived).
    timer.unref?.();
  });
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
 * ENDPOINTS/PAYLOADS abaixo foram conferidos contra o README público do
 * projeto nesta sessão (2026-09-02) — NÃO contra uma instância real rodando
 * (nenhum Docker foi de fato executado aqui, então isto ainda não é uma
 * integração testada):
 *   - `POST {baseUrl}/tabs` com `{ userId, sessionKey, url }` → cria uma tab,
 *     resposta inclui `id`.
 *   - `POST {baseUrl}/tabs/:id/navigate` com `{ userId, macro, query }` →
 *     navega/roda a macro de busca.
 *   - `GET {baseUrl}/tabs/:id/snapshot` → snapshot da página.
 *   - `DELETE {baseUrl}/tabs/:id` → fecha a tab, SEMPRE (inclusive em erro,
 *     via try/finally).
 *   - `Authorization: Bearer {accessKey}` em todo request quando `accessKey`
 *     estiver setado (`CAMOFOX_ACCESS_KEY`).
 * Isto corrige a lógica de requisição do `CamofoxScrapingClient` do branch
 * antigo (que tinha suposições furadas sobre esse fluxo) — só o `CallQueue`
 * dele foi reaproveitado (ver acima).
 *
 * DUAS RESSALVAS AINDA NÃO VERIFICADAS CONTRA UMA INSTÂNCIA REAL (só contra
 * a documentação pública do projeto):
 *   1. O formato de resposta do `GET /snapshot` documentado é um blob de
 *      texto tipo árvore de acessibilidade (algo como
 *      `{ snapshot: "[link e2] Learn more ..." }`), NÃO uma lista
 *      estruturada de resultados com título/URL prontos. `parseCamofoxResults`
 *      abaixo tenta primeiro um formato estruturado (`results`/`items`/
 *      `posts` — array), e cai para um parser best-effort do texto da árvore
 *      quando não encontra nada estruturado. Nesse fallback, `url` fica como
 *      string vazia (o texto da árvore expõe só o `ref` do elemento, não o
 *      href) até alguém plugar uma correlação real com `GET /tabs/:id/links`
 *      (endpoint que existe no serviço mas não é chamado aqui).
 *   2. Pela documentação pública, macros de Reddit devolvem o resultado como
 *      JSON diretamente na resposta do próprio `POST .../navigate` (sem
 *      precisar do snapshot depois) — diferente de `@google_search`/
 *      `@yelp_search`. Esta implementação sempre chama o snapshot (conforme
 *      o fluxo acima), mas tenta primeiro extrair resultados estruturados da
 *      própria resposta do `navigate` antes de recorrer ao snapshot — o que
 *      deveria cobrir esse caso, mas isso não foi testado contra uma
 *      instância real do camofox rodando `@reddit_search`. Confirmar antes
 *      de habilitar essa fonte em produção.
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
      const snapshot = await this.getSnapshot(tabId);
      return parseCamofoxResults(snapshot, params.limit);
    } finally {
      await this.closeTabSafely(tabId);
    }
  }

  private async createTab(): Promise<string> {
    const body = (await this.request('POST', '/tabs', {
      userId: DEFAULT_USER_ID,
      sessionKey: randomUUID(),
      url: 'about:blank',
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

  private async getSnapshot(tabId: string): Promise<unknown> {
    return this.request('GET', `/tabs/${tabId}/snapshot`);
  }

  private async closeTabSafely(tabId: string): Promise<void> {
    try {
      await this.request('DELETE', `/tabs/${tabId}`);
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
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`camofox respondeu ${response.status} ${response.statusText} para ${method} ${path}`);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json().catch(() => null);
  }
}

/**
 * Extrai `CamofoxSearchResult[]` de uma resposta bruta que pode vir tanto do
 * `POST .../navigate` (macros de Reddit — ver ressalva 2 no comentário da
 * classe) quanto do `GET .../snapshot` (demais macros — ver ressalva 1).
 * Isolada nesta função por ser o ponto mais provável de precisar ajuste
 * assim que alguém testar contra uma instância real do camofox-browser.
 * Nunca lança erro por formato inesperado — na pior hipótese devolve `[]`.
 */
function parseCamofoxResults(raw: unknown, limit: number): CamofoxSearchResult[] {
  const items = extractItemsArray(raw);
  if (items) {
    return items.slice(0, limit).map(toStructuredResult);
  }
  const text = extractSnapshotText(raw);
  if (!text) {
    return [];
  }
  return parseAccessibilityTreeLinks(text, limit);
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

function extractSnapshotText(raw: unknown): string | null {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    const snapshot = (raw as Record<string, unknown>).snapshot;
    if (typeof snapshot === 'string') {
      return snapshot;
    }
  }
  return null;
}

/**
 * Parser best-effort do formato de árvore de acessibilidade do camofox
 * (ex.: `[link e2] Learn more`) — extrai só o texto de cada link como
 * `title`; `url` fica vazio porque essa árvore só expõe o `ref` do
 * elemento, não o href real (ver ressalva 1 no comentário da classe).
 */
function parseAccessibilityTreeLinks(text: string, limit: number): CamofoxSearchResult[] {
  const linkPattern = /\[link\s+(\S+?)\]\s*(.*)/g;
  const results: CamofoxSearchResult[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(text)) !== null && results.length < limit) {
    const ref = match[1];
    const title = match[2]?.trim() ?? '';
    results.push({
      title: title || null,
      url: '',
      textContent: null,
      raw: { ref, text: title },
    });
  }
  return results;
}

function toStructuredResult(item: Record<string, unknown>): CamofoxSearchResult {
  return {
    title: typeof item.title === 'string' ? item.title : null,
    url:
      typeof item.url === 'string'
        ? item.url
        : typeof item.postUrl === 'string'
          ? item.postUrl
          : '',
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
