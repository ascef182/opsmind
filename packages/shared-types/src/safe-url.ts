/**
 * Validação de esquema de URL vinda de fonte NÃO CONFIÁVEL (raspagem de sites
 * de terceiros, resultados de busca, URLs ecoadas pela IA a partir de
 * conteúdo raspado).
 *
 * Por que isto existe: `Lead.socialLinks` é escrito direto no Prisma pelo
 * `apps/worker` (`lead-scrape-processor.ts`), sem passar por nenhum DTO/
 * class-validator da API, e `MarketOpportunity.sourceUrls` vem da IA ecoando
 * URLs de posts raspados do Reddit. Essas strings acabam num `href` do
 * frontend — um valor como `javascript:...` ou `data:text/html,...` viraria
 * XSS armazenado no clique de um usuário autenticado. Um `<a href>` só deve
 * apontar para http/https.
 *
 * Regra única e deliberadamente estreita: parseável por `new URL()` E
 * `protocol` ∈ {http:, https:}. Nada de match por substring (um
 * `javascript:alert(1)//instagram.com` passaria num `includes('instagram.com')`
 * — foi exatamente esse o furo encontrado na revisão final).
 *
 * Vive em `@opsmind/shared-types` (e não duplicado em cada app) porque as três
 * pontas — `apps/worker` (ingestão), `apps/api` (persistência do clustering) e
 * `apps/web` (render) — precisam concordar bit-a-bit sobre o que é seguro,
 * mesmo racional de `scoreLead()`.
 */
const SAFE_URL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

export function isSafeHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.trim() === '') {
    return false;
  }
  try {
    return SAFE_URL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    // Não parseável (lixo de raspagem, URL relativa) — nunca vira `href`.
    return false;
  }
}
