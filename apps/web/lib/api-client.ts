import { env } from './env';
import { clearTokens, getStoredTokens, storeTokens, type StoredTokens } from './auth/token-storage';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** FormData (upload de arquivo) passa direto, sem JSON.stringify. */
  body?: unknown;
  /** false para /auth/register e /auth/login — não há token pra anexar ainda. */
  auth?: boolean;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(data.message)) {
      return data.message.join(', ');
    }
    if (typeof data.message === 'string') {
      return data.message;
    }
  } catch {
    // Corpo não é JSON (ou já foi consumido) — cai na mensagem genérica abaixo.
  }
  return `Erro ${response.status}`;
}

function rawFetch(path: string, options: RequestOptions, accessToken?: string): Promise<Response> {
  const isFormData = options.body instanceof FormData;
  return fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      // FormData define seu próprio Content-Type (com boundary) — setar
      // manualmente aqui quebraria o multipart. O browser cuida disso.
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: isFormData
      ? (options.body as FormData)
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
  });
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Refresh token gira a cada uso (rotação, checklist de segurança da Fase 1)
 * — se duas requests baterem em 401 ao mesmo tempo, cada uma tentando
 * refresh separadamente queimaria o refresh token da outra. Uma promise
 * compartilhada garante uma única chamada de /auth/refresh em voo.
 */
async function refreshAccessToken(tokens: StoredTokens): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const response = await rawFetch('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: tokens.refreshToken },
      });
      if (!response.ok) {
        clearTokens();
        return null;
      }
      const data = (await response.json()) as StoredTokens;
      storeTokens(data);
      return data.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * Wrapper único sobre fetch pro front inteiro: anexa o access token,
 * tenta um refresh silencioso em 401 (uma vez), e normaliza erros da API
 * (`{message}` do NestJS) em `ApiError` com mensagem legível.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const useAuth = options.auth ?? true;
  const tokens = useAuth ? getStoredTokens() : null;

  let response = await rawFetch(path, options, tokens?.accessToken);

  if (response.status === 401 && useAuth && tokens) {
    const newAccessToken = await refreshAccessToken(tokens);
    if (newAccessToken) {
      response = await rawFetch(path, options, newAccessToken);
    }
  }

  if (!response.ok) {
    throw new ApiError(await parseErrorMessage(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/** Downloads binários (ex.: documentos) não passam pelo parser JSON de apiFetch. */
export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string }> {
  const tokens = getStoredTokens();
  let response = await rawFetch(path, {}, tokens?.accessToken);

  if (response.status === 401 && tokens) {
    const newAccessToken = await refreshAccessToken(tokens);
    if (newAccessToken) {
      response = await rawFetch(path, {}, newAccessToken);
    }
  }

  if (!response.ok) {
    throw new ApiError(await parseErrorMessage(response), response.status);
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : 'download';
  const blob = await response.blob();
  return { blob, filename };
}
