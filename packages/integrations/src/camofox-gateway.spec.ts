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

  describe('parseAccessibilityTreeLinks (via search) — Finding 1: never fabricates url', () => {
    it('descarta entradas da árvore de acessibilidade sem URL reconhecível no texto (não fabrica url vazia)', async () => {
      const calls: string[] = [];
      global.fetch = jest.fn(async (input: string) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/tabs')) {
          return jsonResponse({ id: 'tab-1' });
        }
        if (url.includes('/navigate')) {
          // navigate não devolve nada estruturado — força o fallback pro snapshot
          return jsonResponse({ ok: true });
        }
        if (url.includes('/snapshot')) {
          return jsonResponse({
            // Cada elemento numa linha própria — formato real da árvore de
            // acessibilidade (um `.*` guloso sem isso engoliria a linha
            // inteira até o fim do texto).
            snapshot: [
              '[link e2] Learn more',
              '[link e3] https://exemplo.com/pagina-real',
              '[link e4] Sobre nós',
            ].join('\n'),
          });
        }
        // DELETE /tabs/:id
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377');
      const results = await gateway.search({ macro: '@google_search', query: 'padaria', limit: 10 });

      // Só a entrada com URL reconhecível no texto sobrevive — "Learn more" e
      // "Sobre nós" não viram resultado com url:'' fabricado.
      expect(results).toEqual([
        {
          title: 'https://exemplo.com/pagina-real',
          url: 'https://exemplo.com/pagina-real',
          textContent: null,
          raw: { ref: 'e3', text: 'https://exemplo.com/pagina-real' },
        },
      ]);
      expect(results.every((r) => r.url.length > 0)).toBe(true);
    });

    it('devolve lista vazia (nunca url fabricada) quando nenhum link da árvore tem URL reconhecível', async () => {
      global.fetch = jest.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith('/tabs')) return jsonResponse({ id: 'tab-1' });
        if (url.includes('/navigate')) return jsonResponse({ ok: true });
        if (url.includes('/snapshot')) {
          return jsonResponse({ snapshot: ['[link e2] Learn more', '[link e5] Sobre nós'].join('\n') });
        }
        return jsonResponse(null, { status: 204 });
      }) as unknown as typeof fetch;

      const gateway = new CamofoxGatewayService('http://localhost:9377');
      const results = await gateway.search({ macro: '@yelp_search', query: 'padaria', limit: 10 });

      expect(results).toEqual([]);
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
