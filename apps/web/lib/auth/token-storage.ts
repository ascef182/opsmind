const ACCESS_TOKEN_KEY = 'opsmind.accessToken';
const REFRESH_TOKEN_KEY = 'opsmind.refreshToken';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * localStorage, não cookie httpOnly — reflete o contrato atual da API (Fase
 * 1): register/login/refresh devolvem os tokens no corpo da resposta, não
 * via Set-Cookie, então não há outro lugar pra guardá-los no cliente sem
 * mudar esse contrato. Mitigação do lado da API: access token de vida curta
 * (15min) + refresh token rotativo com detecção de reuso (revoga a família
 * inteira) — reduz a janela de um token roubado via XSS, não elimina a
 * superfície. Migrar para cookie httpOnly é uma mudança de contrato da API,
 * fora do escopo deste app.
 */
export function getStoredTokens(): StoredTokens | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!accessToken || !refreshToken) {
    return null;
  }
  return { accessToken, refreshToken };
}

export function storeTokens(tokens: StoredTokens): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}
