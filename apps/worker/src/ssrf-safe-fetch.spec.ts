jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

import { lookup } from 'node:dns/promises';
import { ssrfSafeFetch, SsrfSafeFetchError } from './ssrf-safe-fetch';

type MockReaderChunk = { done: boolean; value?: Uint8Array };

function buildReader(chunks: Uint8Array[]) {
  const queue: MockReaderChunk[] = [...chunks.map((value) => ({ done: false, value })), { done: true }];
  return {
    read: jest.fn(async () => queue.shift() ?? { done: true }),
    cancel: jest.fn(async () => undefined),
    releaseLock: jest.fn(),
  };
}

function buildResponse(options: { status: number; headers?: Record<string, string>; bodyChunks?: string[] }) {
  const headers = options.headers ?? {};
  const bodyChunks = (options.bodyChunks ?? ['']).map((chunk) => new TextEncoder().encode(chunk));
  return {
    status: options.status,
    ok: options.status >= 200 && options.status < 300,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    body: { getReader: () => buildReader(bodyChunks) },
  } as unknown as Response;
}

// IPs de teste: 203.0.113.0/24 e 198.51.100.0/24 são TEST-NET-2/3 (RFC 5737)
// — reservados pra documentação, nunca roteáveis de verdade, e
// deliberadamente FORA de todo range que o blocklist de SSRF bloqueia, pra
// servir de "endereço público" determinístico nos testes sem depender de
// internet real nem de IPs de produção de terceiros.
const PUBLIC_IP_A = '203.0.113.5';
const PUBLIC_IP_B = '198.51.100.9';

describe('ssrfSafeFetch', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock;
  });

  describe('bloqueio por IP literal (sem nem chamar DNS/fetch)', () => {
    it.each([
      ['loopback', 'http://127.0.0.1/'],
      ['metadata/link-local', 'http://169.254.169.254/latest/meta-data/'],
      ['RFC1918 10/8', 'http://10.0.0.5/'],
      ['RFC1918 172.16/12', 'http://172.16.5.1/'],
      ['RFC1918 192.168/16', 'http://192.168.1.1/'],
      ['CGNAT 100.64/10', 'http://100.64.0.1/'],
      ['loopback IPv6', 'http://[::1]/'],
      ['link-local IPv6', 'http://[fe80::1]/'],
    ])('rejeita %s (%s) antes de resolver DNS ou buscar', async (_label, url) => {
      await expect(ssrfSafeFetch(url)).rejects.toThrow(SsrfSafeFetchError);
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('rejeita esquema não http/https antes de qualquer resolução', async () => {
    await expect(ssrfSafeFetch('file:///etc/passwd')).rejects.toThrow(SsrfSafeFetchError);
    await expect(ssrfSafeFetch('javascript:alert(1)')).rejects.toThrow(SsrfSafeFetchError);
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita quando o hostname resolve (DNS) para um IP bloqueado', async () => {
    (lookup as jest.Mock).mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);

    await expect(ssrfSafeFetch('http://attacker-controlled.example/')).rejects.toThrow(SsrfSafeFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita se QUALQUER um dos endereços retornados pelo DNS for bloqueado (não só o primeiro)', async () => {
    (lookup as jest.Mock).mockResolvedValue([
      { address: PUBLIC_IP_A, family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    await expect(ssrfSafeFetch('http://multi-record.example/')).rejects.toThrow(SsrfSafeFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aceita e busca normalmente quando o hostname resolve para IP público', async () => {
    (lookup as jest.Mock).mockResolvedValue([{ address: PUBLIC_IP_A, family: 4 }]);
    fetchMock.mockResolvedValue(buildResponse({ status: 200, bodyChunks: ['<html>ok</html>'] }));

    const result = await ssrfSafeFetch('http://public.example/');

    expect(result).toEqual({
      ok: true,
      status: 200,
      finalUrl: 'http://public.example/',
      body: '<html>ok</html>',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('segue redirecionamento legítimo entre dois hosts públicos, revalidando o segundo', async () => {
    (lookup as jest.Mock)
      .mockResolvedValueOnce([{ address: PUBLIC_IP_A, family: 4 }])
      .mockResolvedValueOnce([{ address: PUBLIC_IP_B, family: 4 }]);
    fetchMock
      .mockResolvedValueOnce(buildResponse({ status: 302, headers: { location: 'https://public-b.example/' } }))
      .mockResolvedValueOnce(buildResponse({ status: 200, bodyChunks: ['segundo host'] }));

    const result = await ssrfSafeFetch('https://public-a.example/');

    expect(result.finalUrl).toBe('https://public-b.example/');
    expect(result.body).toBe('segundo host');
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bloqueia quando o Location de um redirecionamento resolve para IP interno — não chama fetch de novo', async () => {
    (lookup as jest.Mock)
      .mockResolvedValueOnce([{ address: PUBLIC_IP_A, family: 4 }])
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    fetchMock.mockResolvedValueOnce(
      buildResponse({ status: 302, headers: { location: 'http://internal-pivot.example/' } }),
    );

    await expect(ssrfSafeFetch('http://public-a.example/')).rejects.toThrow(SsrfSafeFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('estoura o limite de redirecionamentos configurado', async () => {
    (lookup as jest.Mock).mockResolvedValue([{ address: PUBLIC_IP_A, family: 4 }]);
    fetchMock.mockResolvedValue(buildResponse({ status: 302, headers: { location: 'http://public-a.example/next' } }));

    await expect(ssrfSafeFetch('http://public-a.example/', { maxRedirects: 1 })).rejects.toThrow(SsrfSafeFetchError);
  });

  it('aborta por timeout', async () => {
    jest.useFakeTimers();
    (lookup as jest.Mock).mockResolvedValue([{ address: PUBLIC_IP_A, family: 4 }]);
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const promise = ssrfSafeFetch('http://slow.example/', { timeoutMs: 5000 });
    const assertion = expect(promise).rejects.toThrow(SsrfSafeFetchError);
    await jest.advanceTimersByTimeAsync(5000);

    await assertion;
    jest.useRealTimers();
  });

  it('aborta quando a resposta excede o teto de tamanho configurado', async () => {
    (lookup as jest.Mock).mockResolvedValue([{ address: PUBLIC_IP_A, family: 4 }]);
    const bigChunk = 'x'.repeat(1000);
    fetchMock.mockResolvedValue(buildResponse({ status: 200, bodyChunks: [bigChunk, bigChunk] }));

    await expect(ssrfSafeFetch('http://public.example/', { maxResponseBytes: 500 })).rejects.toThrow(
      SsrfSafeFetchError,
    );
  });
});
