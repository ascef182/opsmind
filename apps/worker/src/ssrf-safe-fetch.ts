// Busca HTTP segura contra SSRF para URLs de origem NÃO CONFIÁVEL
// (`Lead.website`, vindo de scraping/input de terceiro) — usada pelo
// profiler de site (`website-profiler-processor.ts`).
//
// Por que isto existe: nenhum lugar deste repositório tinha proteção de SSRF
// antes desta feature (confirmado por busca no código inteiro durante a
// revisão crítica desta mudança), apesar de já estar escrito como requisito
// em `docs/planning/PRD-v2.md` §2.2 (com o critério de aceite literal
// "rejeitar URL resolvendo para range de IP interno") e do achado A4 de
// `docs/planning/reviews/security-reviewer-review.md` sobre a mesma classe
// de vulnerabilidade no pipeline de PDF. `isSafeHttpUrl`
// (`@opsmind/shared-types`) só valida esquema (defesa de XSS em `href`),
// nunca validou IP — não é proteção de SSRF e nunca foi pensado como tal.
//
// Estratégia: resolver o DNS e validar TODOS os endereços retornados contra
// ranges privados/loopback/link-local/CGNAT antes de conectar, e revalidar
// em CADA salto de redirecionamento (`redirect: 'manual'` — o `fetch`
// nativo do Node 20/undici segue redirecionamento automaticamente sem hook
// de revalidação por salto, então não dá pra confiar nele sozinho).
//
// Risco residual aceito, documentado em vez de ignorado: isto não fecha uma
// janela de DNS rebinding (o IP validado aqui pode não ser bit-a-bit o
// mesmo que o `fetch` interno resolve ao conectar de fato, se o DNS
// autoritativo do host mudar o registro entre a validação e o connect do
// socket). Fechar essa janela por completo exigiria um `Agent`/`connect`
// customizado que valide o IP no momento exato da conexão TCP — isso exigiria
// adicionar `undici` como dependência explícita só para isso, o que não se
// justifica para o modelo de ameaça real aqui (investigar o site público já
// conhecido de um lead, não um alvo adversarial escolhido por um atacante
// com controle total de DNS). Resolver+validar antes de cada request/salto
// já cobre o ataque comum (URL literal apontando para IP interno, ou
// redirecionamento pra IP interno depois de uma URL pública) — exatamente o
// critério de aceite escrito em PRD-v2 §2.2.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { isSafeHttpUrl } from '@opsmind/shared-types';

export class SsrfSafeFetchError extends Error {}

export interface SsrfSafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
}

export interface SsrfSafeFetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  body: string;
}

// 10s: uma página inicial de site institucional responde bem antes disso;
// diferente do timeout de 45s do CamofoxGatewayService, que espera um
// navegador remoto completo renderizar, não só um HTTP GET simples.
const DEFAULT_TIMEOUT_MS = 10_000;
// Salto o suficiente pra seguir um redirecionamento http->https ou
// www-apex normal sem permitir uma cadeia longa como vetor de abuso.
const DEFAULT_MAX_REDIRECTS = 5;
// 2MB: generoso pra uma página HTML de homepage, baixo o suficiente pra não
// virar vetor de exaustão de memória/decompression-bomb-like no worker.
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// `net.BlockList` (nativo do Node, estável desde a v15) em vez de checagem
// de CIDR escrita à mão — menos superfície pra acertar/errar bit a bit numa
// rotina crítica de segurança.
function buildPrivateBlockList(): BlockList {
  const blockList = new BlockList();
  blockList.addSubnet('0.0.0.0', 8, 'ipv4'); // "esta rede" / unspecified
  blockList.addSubnet('10.0.0.0', 8, 'ipv4'); // RFC1918
  blockList.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT (RFC6598)
  blockList.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
  blockList.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local — cobre o metadata 169.254.169.254
  blockList.addSubnet('172.16.0.0', 12, 'ipv4'); // RFC1918
  blockList.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC1918
  blockList.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
  blockList.addSubnet('240.0.0.0', 4, 'ipv4'); // reservado
  blockList.addSubnet('::1', 128, 'ipv6'); // loopback
  blockList.addSubnet('fe80::', 10, 'ipv6'); // link-local
  blockList.addSubnet('fc00::', 7, 'ipv6'); // unique local (ULA)
  blockList.addSubnet('ff00::', 8, 'ipv6'); // multicast
  return blockList;
}

const PRIVATE_BLOCK_LIST = buildPrivateBlockList();

// Endereço IPv4-mapeado em IPv6 (`::ffff:a.b.c.d`) tem que ser desembrulhado
// pro IPv4 real antes de checar — senão `127.0.0.1` disfarçado de
// `::ffff:127.0.0.1` passa pelo BlockList ipv6 sem bater em nada.
const IPV4_MAPPED_PATTERN = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

function isBlockedAddress(address: string): boolean {
  const mapped = address.match(IPV4_MAPPED_PATTERN);
  if (mapped?.[1]) {
    return PRIVATE_BLOCK_LIST.check(mapped[1], 'ipv4');
  }
  const family = isIP(address);
  if (family === 4) {
    return PRIVATE_BLOCK_LIST.check(address, 'ipv4');
  }
  if (family === 6) {
    return PRIVATE_BLOCK_LIST.check(address, 'ipv6');
  }
  // Nem IPv4 nem IPv6 reconhecível — nunca deixa passar por omissão.
  return true;
}

function normalizeHostname(hostname: string): string {
  // `URL.hostname` devolve forma com colchetes para literal IPv6
  // (`[::1]`) — `isIP`/`lookup` não reconhecem os colchetes.
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

async function assertPublicHostname(rawHostname: string): Promise<void> {
  const hostname = normalizeHostname(rawHostname);
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new SsrfSafeFetchError(`IP bloqueado por política de SSRF: ${hostname}`);
    }
    return;
  }
  const records = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (records.length === 0) {
    throw new SsrfSafeFetchError(`não foi possível resolver DNS de "${hostname}"`);
  }
  // Valida TODOS os endereços retornados, não só o primeiro — um host que
  // responde com múltiplos registros (round-robin) só é seguro se nenhum
  // deles for privado/reservado.
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new SsrfSafeFetchError(
        `"${hostname}" resolve para um IP bloqueado por política de SSRF: ${record.address}`,
      );
    }
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

async function readBodyWithCap(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new SsrfSafeFetchError(`resposta excede o limite de ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf-8');
}

/**
 * Busca `targetUrl` com proteção de SSRF (ver racional no topo do arquivo):
 * esquema allowlist, DNS resolvido e validado antes de cada conexão
 * (incluindo cada salto de redirecionamento), timeout e teto de tamanho de
 * resposta. Lança `SsrfSafeFetchError` para qualquer violação — nunca
 * retorna um resultado parcial de uma busca bloqueada.
 */
export async function ssrfSafeFetch(
  targetUrl: string,
  options: SsrfSafeFetchOptions = {},
): Promise<SsrfSafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  let currentUrl = targetUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isSafeHttpUrl(currentUrl)) {
      throw new SsrfSafeFetchError(`esquema de URL não permitido: ${currentUrl}`);
    }
    const parsed = new URL(currentUrl);
    await assertPublicHostname(parsed.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'OpsMindWebsiteProfiler/1.0' },
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new SsrfSafeFetchError(`timeout (${timeoutMs}ms) ao buscar ${currentUrl}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new SsrfSafeFetchError(`redirecionamento sem header Location: ${currentUrl}`);
      }
      // Resolvido contra a URL atual (`parsed`), nunca contra `targetUrl` —
      // um Location relativo tem que herdar o host/esquema do salto atual.
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    const body = await readBodyWithCap(response, maxResponseBytes);
    return { ok: response.ok, status: response.status, finalUrl: currentUrl, body };
  }

  throw new SsrfSafeFetchError(`excedeu o limite de ${maxRedirects} redirecionamentos: ${targetUrl}`);
}
