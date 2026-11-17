// Portão determinístico de pré-aprovação de outreach — checagem em CÓDIGO,
// não só instrução de prompt. Adaptado da lista `BANNED_PHRASES` de
// `harvey/gate.py` (ethanplusai/harvey, MIT), com o mesmo racional do
// próprio Harvey: "regra no prompt é piso, não garantia" — mesmo que o
// modelo ignore `OUTREACH_SYSTEM_PROMPT_LINES` (`outreach.service.ts`), o
// texto ainda passa por uma checagem que não depende do modelo ter
// obedecido nada.
//
// Função pura, sem dependência de framework — mesmo padrão de
// `lead-scoring.ts`, usada só por `apps/api` (`OutreachService.approve()`).
// Ver docs/planning/2026-11-06-harvey-inteligencia-comercial.md §3.1.
export interface OutreachGateResult {
  passed: boolean;
  violations: string[];
}

export interface OutreachGateOptions {
  // Hosts permitidos em qualquer link presente no corpo (ex.: domínio da
  // própria organização). Quando omitido, a checagem de link fora do
  // domínio é pulada — este projeto não tem hoje um campo confirmado de
  // "domínio da organização" para popular isso por padrão (ver comentário
  // em outreach.service.ts no ponto de chamada); fica como extensão futura,
  // não uma regra inventada sem base no código real.
  allowedHosts?: string[];
}

// As quatro primeiras já são literalmente citadas como "evite" em
// `OUTREACH_SYSTEM_PROMPT_LINES` (outreach.service.ts) — aqui elas passam a
// ser também BLOQUEIO, não só instrução. As demais são clichês adicionais
// de texto gerado por IA/marketing em massa, mesmo espírito da lista do
// Harvey, adaptados pro português.
const BANNED_PHRASES: readonly string[] = [
  'solução completa',
  'imperdível',
  'não perca essa oportunidade',
  'revolucionário',
  'revolucionar',
  'transformar seu negócio',
  'ágil e eficiente',
  'é importante notar que',
  'no mundo digital de hoje',
  'em um mercado cada vez mais competitivo',
  'espero que esteja bem',
  'espero que esta mensagem o encontre bem',
  // Elogio artificial e afirmação de desempenho sem evidência, vistos em
  // rascunhos reais revisados pelo time (2026-11-17).
  'dá gosto de ver',
  'tende a procurar outra',
  'fica sem resposta',
  'ficam sem resposta',
  'perdendo clientes',
  'perdendo cliente',
  'perdendo vendas',
  'estão perdendo',
  'está perdendo',
];

// Padrões de tag de merge/placeholder não substituída — um rascunho que
// ainda contém um destes nunca deveria ser aprovado.
const UNRENDERED_PLACEHOLDER_PATTERNS: readonly RegExp[] = [/\{\{\s*[\w.]+\s*\}\}/, /\[[A-Z_]{2,}\]/];

// Mesmo limite usado por `gate.pre_send_check` do Harvey — teto, não meta:
// uma mensagem de primeiro contato muito mais longa que isso já deixou de
// ser "uma mensagem curta e pessoal" (a estrutura de 4 movimentos de
// `OUTREACH_SYSTEM_PROMPT_LINES` pede exatamente o contrário).
const MAX_WORDS = 220;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractLinks(text: string): string[] {
  return text.match(/https?:\/\/[^\s)"'<>]+/gi) ?? [];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedHost(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some(
    (allowed) => host === allowed.toLowerCase() || host.endsWith(`.${allowed.toLowerCase()}`),
  );
}

/**
 * Verifica um rascunho de outreach contra regras determinísticas, nunca
 * dependentes do modelo de IA ter seguido o prompt. Pensado para rodar
 * dentro de `OutreachService.approve()`, bloqueando a aprovação
 * (`BadRequestException`) quando `passed` for `false` — ver wiring em
 * `outreach.service.ts`.
 */
export function checkOutreachGate(
  body: string,
  subject: string | null,
  options: OutreachGateOptions = {},
): OutreachGateResult {
  const violations: string[] = [];
  const haystack = `${subject ?? ''}\n${body}`.toLowerCase();

  for (const phrase of BANNED_PHRASES) {
    if (haystack.includes(phrase)) {
      violations.push(`frase proibida encontrada: "${phrase}"`);
    }
  }

  for (const pattern of UNRENDERED_PLACEHOLDER_PATTERNS) {
    if (pattern.test(body) || (subject && pattern.test(subject))) {
      violations.push('tag de merge/placeholder não substituída encontrada');
      break;
    }
  }

  // Travessão (—) é o tell de texto gerado por IA mais citado pelo time em
  // rascunhos reais — já instruído como proibido em
  // `OUTREACH_SYSTEM_PROMPT_LINES` (outreach.service.ts), agora também
  // bloqueado aqui em código: "regra no prompt é piso, não garantia".
  if (body.includes('—') || (subject && subject.includes('—'))) {
    violations.push('travessão (—) encontrado — reescreva com pontuação alternativa');
  }

  const wordCount = countWords(body);
  if (wordCount > MAX_WORDS) {
    violations.push(`corpo da mensagem excede ${MAX_WORDS} palavras (tem ${wordCount})`);
  }

  if (options.allowedHosts && options.allowedHosts.length > 0) {
    for (const link of extractLinks(body)) {
      const host = hostOf(link);
      if (host && !isAllowedHost(host, options.allowedHosts)) {
        violations.push(`link fora do domínio permitido: ${link}`);
      }
    }
  }

  return { passed: violations.length === 0, violations };
}

// Alvo de tamanho do RASCUNHO gerado (o teto de aprovação acima continua
// valendo para texto editado por humano). Primeiro contato pede 60 a 100
// palavras; e-mail tem assunto e um pouco mais de folga; o roteiro de
// ligação tem três blocos curtos.
const DRAFT_WORD_TARGET: Record<string, number> = {
  EMAIL: 130,
  PHONE: 150,
};
const DEFAULT_DRAFT_WORD_TARGET = 100;

export function draftWordTarget(channel: string): number {
  return DRAFT_WORD_TARGET[channel] ?? DEFAULT_DRAFT_WORD_TARGET;
}

export function countDraftWords(text: string): number {
  return countWords(text);
}

function wordTrigrams(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const trigrams = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) {
    trigrams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return trigrams;
}

/**
 * Maior similaridade (Jaccard sobre trigramas de palavras, 0 a 1) entre o
 * rascunho e mensagens recentes da organização. Pega o "mesmo template com o
 * nome trocado" sem depender do modelo perceber que se repetiu.
 */
export function maxSimilarityToRecent(body: string, recentBodies: readonly string[]): number {
  const current = wordTrigrams(body);
  if (current.size === 0) return 0;
  let max = 0;
  for (const other of recentBodies) {
    const previous = wordTrigrams(other);
    if (previous.size === 0) continue;
    let shared = 0;
    for (const trigram of current) if (previous.has(trigram)) shared++;
    const similarity = shared / (current.size + previous.size - shared);
    if (similarity > max) max = similarity;
  }
  return max;
}
