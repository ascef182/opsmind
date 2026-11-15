// Roteamento de leads — função pura, sem dependência de framework nenhuma
// (nada de Prisma/NestJS aqui), mesmo racional de `lead-scoring.ts`: tanto
// `apps/api` (criação manual de Lead, endpoint de atribuição) quanto
// `apps/worker` (leads chegando em lote via scraping) usam exatamente a
// mesma decisão de "quem recebe o próximo lead", sem risco de divergência
// entre os dois processos. As queries de candidatos/contagem (que exigem
// acesso a banco) ficam em cada chamador — esta função só decide, nunca lê
// nem escreve nada.

export interface LeadAssignmentCandidate {
  userId: string;
  // Quantidade de leads atualmente atribuídos a este usuário e ainda em
  // trabalho (status fora de CONVERTED/LOST) — quanto menor, mais prioridade
  // pra receber o próximo lead. O chamador decide o que conta como "em
  // aberto"; esta função só compara os números recebidos.
  openLeadCount: number;
}

/**
 * Round-robin por carga (não por ponteiro/cursor persistido): sempre escolhe
 * quem tem menos leads em aberto agora, o que se autocorrige sozinho quando
 * alguém entra/sai do time ou libera carga (sem precisar resetar nenhum
 * estado). Em empate, mantém o primeiro candidato da lista — o chamador
 * decide a ordem de desempate (ex.: `Membership.createdAt` ascendente, pra
 * favorecer quem está no time há mais tempo).
 */
export function pickRoundRobinAssignee(candidates: LeadAssignmentCandidate[]): string | null {
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((least, candidate) =>
    candidate.openLeadCount < least.openLeadCount ? candidate : least,
  ).userId;
}
