import { aggregateCopyPerformance, type CopyMessageRow } from './copy-performance';

const at = new Date('2026-11-17T12:00:00Z');

function message(overrides: Partial<CopyMessageRow>): CopyMessageRow {
  return {
    leadId: 'lead-1',
    strategy: 'NO_WEBSITE',
    channel: 'WHATSAPP',
    promptVersion: 'copy-v3',
    status: 'DRAFT',
    body: 'texto',
    originalBody: 'texto',
    approvedAt: null,
    sentAt: null,
    repliedAt: null,
    ...overrides,
  };
}

describe('aggregateCopyPerformance', () => {
  it('conta funil por abordagem e ordena por venda e reunião, não por volume', () => {
    const rows = aggregateCopyPerformance(
      [
        message({ leadId: 'a' }),
        message({ leadId: 'b' }),
        message({ leadId: 'c' }),
        message({
          leadId: 'd',
          strategy: 'WHATSAPP_AUTOMATION',
          approvedAt: at,
          sentAt: at,
          repliedAt: at,
          body: 'editado',
        }),
        message({ leadId: 'e', strategy: 'WHATSAPP_AUTOMATION', approvedAt: at, sentAt: at }),
      ],
      new Map([['d', new Set(['REPLIED', 'MEETING_SCHEDULED', 'LOST'])]]),
    );

    expect(rows[0]).toEqual({
      strategy: 'WHATSAPP_AUTOMATION',
      channel: 'WHATSAPP',
      promptVersion: 'copy-v3',
      drafts: 2,
      approved: 2,
      editedBeforeApproval: 1,
      sent: 2,
      replied: 1,
      meetings: 1,
      proposals: 0,
      won: 0,
      replyRate: 0.5,
      meetingRate: 0.5,
    });
    expect(rows[1]).toMatchObject({ strategy: 'NO_WEBSITE', drafts: 3, sent: 0, replyRate: null });
  });

  it('um lead com duas mensagens enviadas conta uma vez no funil', () => {
    const rows = aggregateCopyPerformance(
      [message({ sentAt: at, approvedAt: at }), message({ sentAt: at, approvedAt: at })],
      new Map([['lead-1', new Set(['WON'])]]),
    );

    expect(rows[0]).toMatchObject({ sent: 2, won: 1, meetings: 1, proposals: 1 });
  });
});
