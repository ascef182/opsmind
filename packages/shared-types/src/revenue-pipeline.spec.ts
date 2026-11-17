import {
  PIPELINE_NEXT_ACTION,
  PIPELINE_STAGE_LABEL,
  REVENUE_PIPELINE_STAGES,
  dealStageToPipelineStage,
  leadStatusToPipelineStage,
  pipelineStageIndex,
} from './revenue-pipeline';

describe('revenue-pipeline', () => {
  it('tem os 15 estágios do funil na ordem comercial', () => {
    expect(REVENUE_PIPELINE_STAGES).toHaveLength(15);
    expect(REVENUE_PIPELINE_STAGES[0]).toBe('DISCOVERED');
    expect(REVENUE_PIPELINE_STAGES.slice(-2)).toEqual(['WON', 'LOST']);
    expect(pipelineStageIndex('CONTACTED')).toBeLessThan(pipelineStageIndex('REPLIED'));
  });

  it('todo estágio tem rótulo e próxima ação', () => {
    for (const stage of REVENUE_PIPELINE_STAGES) {
      expect(PIPELINE_STAGE_LABEL[stage]).toBeTruthy();
      expect(PIPELINE_NEXT_ACTION[stage]).toBeTruthy();
    }
  });

  it.each([
    ['DISCOVERED', 'DISCOVERED'],
    ['QUALIFIED', 'QUALIFIED'],
    ['OUTREACH_DRAFTED', 'OUTREACH_READY'],
    ['OUTREACH_APPROVED', 'OUTREACH_READY'],
    ['CONTACTED', 'CONTACTED'],
    ['REPLIED', 'REPLIED'],
    ['LOST', 'LOST'],
    ['DISQUALIFIED', 'DISQUALIFIED'],
  ])('lead %s vira %s', (status, expected) => {
    expect(leadStatusToPipelineStage(status)).toBe(expected);
  });

  it('lead CONVERTED não tem estágio próprio: o deal assume', () => {
    expect(leadStatusToPipelineStage('CONVERTED')).toBeNull();
  });

  it('status desconhecido não vira estágio', () => {
    expect(leadStatusToPipelineStage('QUALQUER_COISA')).toBeNull();
  });

  it.each([
    ['QUALIFICATION', 'MEETING_SCHEDULED'],
    ['PROPOSAL', 'PROPOSAL_SENT'],
    ['NEGOTIATION', 'NEGOTIATION'],
    ['CONTRACT_SENT', 'NEGOTIATION'],
    ['WON', 'WON'],
    ['LOST', 'LOST'],
  ] as const)('deal %s vira %s', (stage, expected) => {
    expect(dealStageToPipelineStage(stage)).toBe(expected);
  });
});
