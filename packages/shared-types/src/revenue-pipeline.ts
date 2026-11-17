import type { DealStage } from './deal-risk';

// Funil comercial unificado do Revenue Engine. Lead (`LeadStatus`) cobre a
// prospecção até a demonstração; Deal (`DealStage`) cobre da reunião ao
// fechamento. Nenhuma tabela guarda este estágio como estado atual: ele é
// sempre derivado, e só o histórico (`PipelineStageTransition`) o persiste.
export const REVENUE_PIPELINE_STAGES = [
  'DISCOVERED',
  'RESEARCHED',
  'QUALIFIED',
  'OUTREACH_READY',
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'DEMO_REQUESTED',
  'PREVIEW_GENERATING',
  'PREVIEW_READY',
  'MEETING_SCHEDULED',
  'PROPOSAL_SENT',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const;

export type RevenuePipelineStage = (typeof REVENUE_PIPELINE_STAGES)[number];

// Fora do funil: lead reprovado na qualificação nunca foi oportunidade, então
// não conta como LOST (que distorceria a taxa de perda de negociações).
export const PIPELINE_STAGE_DISQUALIFIED = 'DISQUALIFIED';

export type PipelineHistoryStage = RevenuePipelineStage | typeof PIPELINE_STAGE_DISQUALIFIED;

export const TERMINAL_PIPELINE_STAGES: readonly RevenuePipelineStage[] = ['WON', 'LOST'];

const LEAD_STATUS_OVERRIDES: Record<string, PipelineHistoryStage> = {
  OUTREACH_DRAFTED: 'OUTREACH_READY',
  OUTREACH_APPROVED: 'OUTREACH_READY',
  DISQUALIFIED: PIPELINE_STAGE_DISQUALIFIED,
};

const DEAL_STAGE_TO_PIPELINE: Record<DealStage, RevenuePipelineStage> = {
  QUALIFICATION: 'MEETING_SCHEDULED',
  PROPOSAL: 'PROPOSAL_SENT',
  NEGOTIATION: 'NEGOTIATION',
  CONTRACT_SENT: 'NEGOTIATION',
  WON: 'WON',
  LOST: 'LOST',
};

function isPipelineStage(value: string): value is RevenuePipelineStage {
  return (REVENUE_PIPELINE_STAGES as readonly string[]).includes(value);
}

// `null` para CONVERTED (o Deal criado na conversão passa a carregar o
// estágio) e para qualquer status que o funil ainda não conheça.
export function leadStatusToPipelineStage(status: string): PipelineHistoryStage | null {
  const override = LEAD_STATUS_OVERRIDES[status];
  if (override) return override;
  return isPipelineStage(status) ? status : null;
}

export function dealStageToPipelineStage(stage: DealStage): RevenuePipelineStage {
  return DEAL_STAGE_TO_PIPELINE[stage];
}

export function pipelineStageIndex(stage: RevenuePipelineStage): number {
  return REVENUE_PIPELINE_STAGES.indexOf(stage);
}

export const PIPELINE_STAGE_LABEL: Record<RevenuePipelineStage, string> = {
  DISCOVERED: 'Descoberto',
  RESEARCHED: 'Pesquisado',
  QUALIFIED: 'Qualificado',
  OUTREACH_READY: 'Outreach pronto',
  CONTACTED: 'Contatado',
  REPLIED: 'Respondeu',
  INTERESTED: 'Interessado',
  DEMO_REQUESTED: 'Demo solicitada',
  PREVIEW_GENERATING: 'Gerando preview',
  PREVIEW_READY: 'Preview pronto',
  MEETING_SCHEDULED: 'Reunião',
  PROPOSAL_SENT: 'Proposta enviada',
  NEGOTIATION: 'Negociação',
  WON: 'Ganho',
  LOST: 'Perdido',
};

export const PIPELINE_NEXT_ACTION: Record<RevenuePipelineStage, string> = {
  DISCOVERED: 'Investigar site e contatos',
  RESEARCHED: 'Pontuar a oportunidade',
  QUALIFIED: 'Gerar rascunho de outreach',
  OUTREACH_READY: 'Revisar e aprovar o rascunho',
  CONTACTED: 'Aguardar resposta ou agendar follow-up',
  REPLIED: 'Ler e classificar a resposta',
  INTERESTED: 'Oferecer um conceito de site',
  DEMO_REQUESTED: 'Gerar o preview do site',
  PREVIEW_GENERATING: 'Aguardar a geração',
  PREVIEW_READY: 'Revisar o preview e apresentar',
  MEETING_SCHEDULED: 'Preparar e conduzir a reunião',
  PROPOSAL_SENT: 'Acompanhar a proposta',
  NEGOTIATION: 'Fechar condições e contrato',
  WON: 'Iniciar a entrega',
  LOST: 'Registrar o motivo da perda',
};
