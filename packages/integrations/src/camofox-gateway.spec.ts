import { CamofoxGatewayService } from './camofox-gateway';

describe('CamofoxGatewayService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function jsonResponse(body: unknown, init?: { status?: number }): Response {
    return {
      ok: (init?.status ?? 200) < 400,
      status: init?.status ?? 200,
      statusText: 'OK',
      json: async () => body,
    } as unknown as Response;
  }

  // Os 3 testes abaixo foram todos confirmados ao vivo contra uma instância
  // real do camofox-browser (v1.16.0, rodando nativo fora do Docker) — o
  // contrato documentado em `camofox-gateway.ts` (Ressalva no topo do
  // arquivo: "não testado contra uma instância real") estava desatualizado
  // em 3 pontos independentes.
  describe('requisições ao camofox — corpo/query corretos pra API atual', () => {
    it('createTab: não envia o campo "url" no corpo (about:blank agora é rejeitado com 400 pelo servidor)', async () => {
      let tabsRequestBody: string | undefined;
      global.fetch = jest.fn(async (input: string, init?: { body?: string }) => {
        const url = String(input);
        if (url.endsWith('/tabs')) {
          tabsRequestBody = init?.body;
          return jsonResponse({ id: 'tab-1' });
        }
        if (url.includes('/navigate')) return jsonResponse({ ok: true });
        if (url.includes('/links')) return jsonResponse({ links: [] });
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377', undefined, undefined, undefined, 0);
      await gateway.search({ macro: '@google_search', query: 'padaria', limit: 10 });

      expect(tabsRequestBody).toBeDefined();
      const parsed = JSON.parse(tabsRequestBody as string);
      expect(parsed).not.toHaveProperty('url');
      expect(parsed).toMatchObject({ userId: expect.any(String), sessionKey: expect.any(String) });
    });

    it('getLinks: manda userId como query param (obrigatório — servidor responde 400 sem ele)', async () => {
      const calledUrls: string[] = [];
      global.fetch = jest.fn(async (input: string) => {
        const url = String(input);
        calledUrls.push(url);
        if (url.endsWith('/tabs')) return jsonResponse({ id: 'tab-1' });
        if (url.includes('/navigate')) return jsonResponse({ ok: true });
        if (url.includes('/links')) return jsonResponse({ links: [] });
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377', undefined, undefined, undefined, 0);
      await gateway.search({ macro: '@google_search', query: 'padaria', limit: 10 });

      const linksUrl = calledUrls.find((u) => u.includes('/links'));
      expect(linksUrl).toMatch(/[?&]userId=/);
    });

    it('closeTabSafely: manda userId como query param no DELETE (obrigatório — servidor responde 400 sem ele)', async () => {
      const calledUrls: string[] = [];
      global.fetch = jest.fn(async (input: string, init?: { method?: string }) => {
        const url = String(input);
        calledUrls.push(url);
        if (url.endsWith('/tabs')) return jsonResponse({ id: 'tab-1' });
        if (url.includes('/navigate')) return jsonResponse({ ok: true });
        if (url.includes('/links')) return jsonResponse({ links: [] });
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377', undefined, undefined, undefined, 0);
      await gateway.search({ macro: '@google_search', query: 'padaria', limit: 10 });

      const deleteUrl = calledUrls.find((u) => /\/tabs\/[^/?]+(\?|$)/.test(u) && !u.endsWith('/tabs'));
      expect(deleteUrl).toMatch(/[?&]userId=/);
    });
  });

  // Descoberto ao vivo (2026-09-17) contra uma instância real: `GET
  // .../links` devolve URLs ABSOLUTAS já resolvidas pelo próprio
  // camofox-browser (não um `ref` sem href, como a implementação antiga
  // assumia) — mas a maioria dos links de uma página de resultados do
  // Google/DuckDuckGo aponta de volta pro próprio motor de busca (abas,
  // filtros, menu, rodapé), não pro site do resultado.
  describe('toLinkResults (via search) — filtra chrome do motor de busca, nunca fabrica url', () => {
    it('descarta links que apontam de volta pro próprio motor de busca (chrome/nav/filtros)', async () => {
      global.fetch = jest.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith('/tabs')) return jsonResponse({ id: 'tab-1' });
        if (url.includes('/navigate')) return jsonResponse({ ok: true, searchEngine: 'duckduckgo' });
        if (url.includes('/links')) {
          return jsonResponse({
            links: [
              { url: 'https://duckduckgo.com/', text: 'DuckDuckGo' },
              { url: 'https://duckduckgo.com/?q=padaria&ia=images', text: 'Images' },
              {
                url: 'https://www.listamais.com.br/categoria/padaria-em-presidente-prudente-sp',
                text: 'https://www.listamais.com.br › categoria › padaria-em-presidente-prudente-sp',
              },
            ],
          });
        }
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377', undefined, undefined, undefined, 0);
      const results = await gateway.search({ macro: '@google_search', query: 'padaria', limit: 10 });

      expect(results).toEqual([
        {
          title: 'https://www.listamais.com.br › categoria › padaria-em-presidente-prudente-sp',
          url: 'https://www.listamais.com.br/categoria/padaria-em-presidente-prudente-sp',
          textContent: null,
          raw: {
            url: 'https://www.listamais.com.br/categoria/padaria-em-presidente-prudente-sp',
            text: 'https://www.listamais.com.br › categoria › padaria-em-presidente-prudente-sp',
          },
        },
      ]);
    });

    it('NÃO filtra por host em @yelp_search (resultado real mora no próprio domínio yelp.com)', async () => {
      global.fetch = jest.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith('/tabs')) return jsonResponse({ id: 'tab-1' });
        if (url.includes('/navigate')) return jsonResponse({ ok: true });
        if (url.includes('/links')) {
          return jsonResponse({
            links: [{ url: 'https://www.yelp.com/biz/padaria-exemplo', text: 'Padaria Exemplo' }],
          });
        }
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377', undefined, undefined, undefined, 0);
      const results = await gateway.search({ macro: '@yelp_search', query: 'padaria', limit: 10 });

      expect(results.map((r) => r.url)).toEqual(['https://www.yelp.com/biz/padaria-exemplo']);
    });

    it('devolve lista vazia (nunca url fabricada) quando nenhum link sobrevive ao filtro, mesmo após retry', async () => {
      global.fetch = jest.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith('/tabs')) return jsonResponse({ id: 'tab-1' });
        if (url.includes('/navigate')) return jsonResponse({ ok: true });
        if (url.includes('/links')) {
          return jsonResponse({ links: [{ url: 'https://www.google.com/preferences', text: 'Settings' }] });
        }
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377', undefined, undefined, undefined, 0);
      const results = await gateway.search({ macro: '@google_search', query: 'padaria', limit: 10 });

      expect(results).toEqual([]);
    });

    it('tenta de novo (até RENDER_WAIT_MAX_ATTEMPTS) quando a primeira leitura de .../links vem vazia', async () => {
      let linksCallCount = 0;
      global.fetch = jest.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith('/tabs')) return jsonResponse({ id: 'tab-1' });
        if (url.includes('/navigate')) return jsonResponse({ ok: true });
        if (url.includes('/links')) {
          linksCallCount += 1;
          // Primeira leitura: página ainda renderizando, só o "chrome". Segunda: resultado real.
          if (linksCallCount === 1) {
            return jsonResponse({ links: [{ url: 'https://duckduckgo.com/', text: 'DuckDuckGo' }] });
          }
          return jsonResponse({
            links: [{ url: 'https://exemplo.com/padaria', text: 'Padaria Exemplo' }],
          });
        }
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377', undefined, undefined, undefined, 0);
      const results = await gateway.search({ macro: '@google_search', query: 'padaria', limit: 10 });

      expect(linksCallCount).toBe(2);
      expect(results.map((r) => r.url)).toEqual(['https://exemplo.com/padaria']);
    });
  });

  describe('toStructuredResult (via search) — nunca fabrica url no path estruturado', () => {
    it('descarta itens sem url/postUrl/permalink e resolve permalink relativo contra reddit.com', async () => {
      global.fetch = jest.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith('/tabs')) return jsonResponse({ id: 'tab-1' });
        if (url.includes('/navigate')) {
          // Formato "Reddit JSON direto no navigate" (ressalva 2 da classe).
          return jsonResponse({
            results: [
              { title: 'Post com url absoluta', url: 'https://reddit.com/r/x/comments/1' },
              {
                title: 'Post só com permalink relativo',
                permalink: '/r/x/comments/2/titulo/',
              },
              { title: 'Post sem nenhum campo de URL reconhecível', selftext: 'oi' },
            ],
          });
        }
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377');
      const results = await gateway.search({ macro: '@reddit_search', query: 'padaria', limit: 10 });

      expect(results).toEqual([
        {
          title: 'Post com url absoluta',
          url: 'https://reddit.com/r/x/comments/1',
          textContent: null,
          raw: { title: 'Post com url absoluta', url: 'https://reddit.com/r/x/comments/1' },
        },
        {
          title: 'Post só com permalink relativo',
          url: 'https://www.reddit.com/r/x/comments/2/titulo/',
          textContent: null,
          raw: { title: 'Post só com permalink relativo', permalink: '/r/x/comments/2/titulo/' },
        },
      ]);
      expect(results.every((r) => r.url.length > 0)).toBe(true);
    });

    it('respeita o limit contando só os itens com URL resolvida (não os descartados)', async () => {
      global.fetch = jest.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith('/tabs')) return jsonResponse({ id: 'tab-1' });
        if (url.includes('/navigate')) {
          return jsonResponse({
            results: [
              { title: 'sem url', selftext: 'oi' },
              { title: 'a', url: 'https://exemplo.com/a' },
              { title: 'sem url 2', selftext: 'oi' },
              { title: 'b', url: 'https://exemplo.com/b' },
            ],
          });
        }
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377');
      const results = await gateway.search({ macro: '@reddit_search', query: 'padaria', limit: 2 });

      expect(results.map((r) => r.url)).toEqual(['https://exemplo.com/a', 'https://exemplo.com/b']);
    });
  });

  describe('request() timeout — Finding 2: never hangs indefinitely', () => {
    it('lança erro de timeout em vez de travar quando o fetch nunca resolve', async () => {
      // Timers reais (curtos, 50ms) em vez de fake timers: o `AbortController`
      // do código sob teste dispara o `abort` real via `setTimeout`, e um
      // fetch mockado que só rejeita quando o signal aborta precisa desse
      // `setTimeout` de verdade rodando — misturar isso com fake timers e
      // `advanceTimersByTimeAsync` cria uma corrida de microtasks que dispara
      // falsos "unhandled rejection" no Jest.
      global.fetch = jest.fn((input: string, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/tabs')) {
          // Nunca resolve por conta própria — simula um camofox travado.
          // Respeita o AbortSignal de verdade (como o fetch real faria),
          // pra exercitar o comportamento de timeout do código sob teste.
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        }
        return Promise.resolve(jsonResponse(null, { status: 204 }));
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377', undefined, 2_000, 50);

      await expect(
        gateway.search({ macro: '@google_search', query: 'padaria', limit: 5 }),
      ).rejects.toThrow(/timeout \(50ms\)/);
    });
  });
});
