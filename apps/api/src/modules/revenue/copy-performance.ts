import type { RevenuePipelineStage } from '@opsmind/shared-types';

// Desempenho de copy por abordagem: o que importa é conversa comercial e
// receita (reunião, proposta, venda), não volume de rascunhos nem abertura.

export interface CopyMessageRow {
  leadId: string;
  strategy: string;
  channel: string;
  promptVersion: string | null;
  status: string;
  body: string;
  originalBody: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  repliedAt: Date | null;
}

export interface CopyPerformanceRow {
  strategy: string;
  channel: string;
  promptVersion: string | null;
  drafts: number;
  approved: number;
  editedBeforeApproval: number;
  sent: number;
  replied: number;
  meetings: number;
  proposals: number;
  won: number;
  replyRate: number | null;
  meetingRate: number | null;
}

const MEETING_OR_LATER: RevenuePipelineStage[] = ['MEETING_SCHEDULED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON'];
const PROPOSAL_OR_LATER: RevenuePipelineStage[] = ['PROPOSAL_SENT', 'NEGOTIATION', 'WON'];

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 1000;
}

/**
 * Um lead conta para a abordagem da mensagem que foi enviada a ele. Etapas
 * vêm do histórico de transições (o estágio atual do deal perderia quem
 * passou por reunião e depois foi perdido).
 */
export function aggregateCopyPerformance(
  messages: CopyMessageRow[],
  stagesReachedByLead: Map<string, Set<string>>,
): CopyPerformanceRow[] {
  const rows = new Map<string, CopyPerformanceRow & { leads: Set<string> }>();

  for (const message of messages) {
    const key = `${message.strategy}|${message.channel}|${message.promptVersion ?? ''}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        strategy: message.strategy,
        channel: message.channel,
        promptVersion: message.promptVersion,
        drafts: 0,
        approved: 0,
        editedBeforeApproval: 0,
        sent: 0,
        replied: 0,
        meetings: 0,
        proposals: 0,
        won: 0,
        replyRate: null,
        meetingRate: null,
        leads: new Set(),
      };
      rows.set(key, row);
    }

    row.drafts++;
    if (message.approvedAt) {
      row.approved++;
      if (message.originalBody !== null && message.originalBody.trim() !== message.body.trim()) {
        row.editedBeforeApproval++;
      }
    }
    if (!message.sentAt) continue;
    row.sent++;
    if (message.repliedAt) row.replied++;
    if (row.leads.has(message.leadId)) continue;
    row.leads.add(message.leadId);
    const reached = stagesReachedByLead.get(message.leadId) ?? new Set<string>();
    if (MEETING_OR_LATER.some((stage) => reached.has(stage))) row.meetings++;
    if (PROPOSAL_OR_LATER.some((stage) => reached.has(stage))) row.proposals++;
    if (reached.has('WON')) row.won++;
  }

  return [...rows.values()]
    .map(({ leads: _leads, ...row }) => ({
      ...row,
      replyRate: rate(row.replied, row.sent),
      meetingRate: rate(row.meetings, row.sent),
    }))
    .sort((a, b) => b.won - a.won || b.meetings - a.meetings || b.replied - a.replied || b.drafts - a.drafts);
}
