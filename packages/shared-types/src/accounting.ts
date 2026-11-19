import { simulate, type SimulationInput, type SimulationResult } from './simples-nacional';

// Espaço do contador (OpsGov Fase 5): comparativo de propostas e as decisões
// abertas da passagem MEI → ME. Valores em centavos.

export const ACCOUNTING_SCENARIOS = ['A_TRANSFORMAR', 'B_NOVO_CNPJ'] as const;
export type AccountingScenario = (typeof ACCOUNTING_SCENARIOS)[number];

export const ACCOUNTING_DECISION_STATUSES = ['PENDENTE', 'EM_ANALISE', 'DECIDIDO'] as const;
export type AccountingDecisionStatus = (typeof ACCOUNTING_DECISION_STATUSES)[number];

export interface ProposalCosts {
  id: string;
  /** Custos iniciais (abertura/transformação, alteração contratual, certificado...). */
  setupCents: number;
  monthlyFeeCents: number;
  /** Custos anuais além das mensalidades (13ª mensalidade, DEFIS, IRPF do sócio...). */
  annualCents: number;
}

export interface ProposalComparison {
  id: string;
  feesFirstYearCents: number;
  feesRecurringYearCents: number;
  taxesYearCents: number;
  firstYearCents: number;
  recurringYearCents: number;
}

export interface AccountingComparison {
  /** Tributos estimados: o menor custo mensal entre ficar como está e aplicar o Fator R, × 12. */
  taxBasis: 'ATUAL' | 'COM_FATOR_R';
  monthlyTaxCents: number;
  simulation: SimulationResult;
  proposals: ProposalComparison[];
  cheapestFirstYearId: string | null;
  cheapestRecurringId: string | null;
}

function cheapest(rows: ProposalComparison[], pick: (row: ProposalComparison) => number): string | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => (pick(row) < pick(best) ? row : best)).id;
}

/**
 * Custo do 1º ano (inicial + 12 mensalidades + anuais + tributos) e do 2º ano
 * em diante (sem o inicial) por proposta. Os tributos vêm de `simulate` (Fase 3)
 * e são os mesmos para todas as propostas: o que muda entre escritórios é o
 * honorário; o que muda entre cenários A/B costuma estar no custo inicial.
 */
export function accountingCostComparison(proposals: ProposalCosts[], taxInput: SimulationInput): AccountingComparison {
  const simulation = simulate(taxInput);
  const useFatorR = simulation.comFatorR.custoTotalCents < simulation.atual.custoTotalCents;
  const monthlyTaxCents = useFatorR ? simulation.comFatorR.custoTotalCents : simulation.atual.custoTotalCents;
  const taxesYearCents = monthlyTaxCents * 12;

  const rows = proposals.map((p) => {
    const feesRecurringYearCents = p.monthlyFeeCents * 12 + p.annualCents;
    const feesFirstYearCents = p.setupCents + feesRecurringYearCents;
    return {
      id: p.id,
      feesFirstYearCents,
      feesRecurringYearCents,
      taxesYearCents,
      firstYearCents: feesFirstYearCents + taxesYearCents,
      recurringYearCents: feesRecurringYearCents + taxesYearCents,
    };
  });

  return {
    taxBasis: useFatorR ? 'COM_FATOR_R' : 'ATUAL',
    monthlyTaxCents,
    simulation,
    proposals: rows,
    cheapestFirstYearId: cheapest(rows, (r) => r.firstYearCents),
    cheapestRecurringId: cheapest(rows, (r) => r.recurringYearCents),
  };
}

export interface DefaultAccountingDecision {
  key: string;
  topic: string;
  question: string;
}

/** Decisões em aberto da passagem MEI → ME (CazaTech, jan/2027). */
export const DEFAULT_ACCOUNTING_DECISIONS: readonly DefaultAccountingDecision[] = [
  {
    key: 'cnpj',
    topic: 'CNPJ atual ou novo',
    question:
      'Transformar o CNPJ do MEI em ME (cenário A) ou abrir um CNPJ novo (cenário B)? O que acontece com contratos, conta bancária e atestados emitidos no CNPJ atual?',
  },
  {
    key: 'saida_simei',
    topic: 'Saída do SIMEI',
    question: 'Como e até quando comunicar o desenquadramento do SIMEI para valer em janeiro de 2027, e o que muda no Portal do Simples?',
  },
  {
    key: 'natureza_juridica',
    topic: 'Natureza jurídica',
    question: 'EI, SLU ou LTDA? Qual protege melhor o patrimônio pessoal e o que muda em custo e em obrigações?',
  },
  {
    key: 'regime',
    topic: 'Regime tributário',
    question: 'O Simples Nacional é o melhor regime para a receita prevista, ou vale comparar com o Lucro Presumido?',
  },
  {
    key: 'ibs_cbs',
    topic: 'Opção IBS/CBS',
    question:
      'Recolher IBS/CBS dentro do DAS ou pelo regime regular a partir de 2027? Qual o efeito para clientes que aproveitam crédito, incluindo órgãos públicos?',
  },
  {
    key: 'cnaes_tecnologia',
    topic: 'CNAEs de tecnologia',
    question: 'Quais CNAEs incluir para os serviços de tecnologia e em que anexo do Simples cada um se enquadra?',
  },
  {
    key: 'servicos_celio',
    topic: 'Serviços do Célio',
    question: 'Como formalizar os serviços do Célio (sócio, prestador ou empregado) e qual o efeito na folha e no Fator R?',
  },
  {
    key: 'cnaes_atuais',
    topic: 'CNAEs atuais',
    question: 'Manter, trocar ou remover 82.19-9/99, 85.99-6/99 e 82.30-0/01 na passagem para ME?',
  },
  {
    key: 'fator_r',
    topic: 'Fator R e pró-labore',
    question: 'Qual pró-labore mantém o Fator R em 28% ou mais (Anexo III) e como acompanhar isso mês a mês?',
  },
  {
    key: 'notas_fiscais',
    topic: 'Emissão de notas',
    question: 'Como emitir NFS-e como ME (emissor nacional ou municipal) e o que muda na virada de dezembro para janeiro?',
  },
  {
    key: 'contratos_publicos',
    topic: 'Contratos públicos',
    question: 'Quais certidões, atestados e declarações de ME/EPP são necessários para licitar, e como usar o tratamento diferenciado da LC 123?',
  },
  {
    key: 'teto_mei_2027',
    topic: 'Teto do MEI 2027',
    question: 'Se o faturamento de 2026 passar do teto do MEI, desde quando vale o desenquadramento e há DAS complementar a pagar?',
  },
  {
    key: 'endereco_sede',
    topic: 'Endereço da sede',
    question: 'A sede pode continuar no endereço atual? Exige alvará, inscrição municipal ou endereço fiscal diferente?',
  },
];
