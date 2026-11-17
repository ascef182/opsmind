import { computeStageFlows, periodWindows, type TransitionRow } from './revenue-metrics';

const t0 = new Date('2026-11-01T00:00:00Z').getTime();
const at = (hours: number) => new Date(t0 + hours * 3_600_000);

function flow(rows: TransitionRow[], stage: string) {
  return computeStageFlows(rows).find((f) => f.stage === stage)!;
}

describe('periodWindows', () => {
  it('janela "week" = últimos 7 dias contra os 7 anteriores, contíguas', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const { current, previous } = periodWindows('week', now);

    expect(current.end).toEqual(now);
    expect(current.start).toEqual(new Date('2026-11-10T12:00:00Z'));
    expect(previous.end).toEqual(current.start);
    expect(previous.start).toEqual(new Date('2026-11-03T12:00:00Z'));
  });
});

describe('computeStageFlows', () => {
  it('conta entrada, avanço e conversão por estágio', () => {
    const rows: TransitionRow[] = [
      { leadId: 'a', dealId: null, toStage: 'DISCOVERED', occurredAt: at(0) },
      { leadId: 'a', dealId: null, toStage: 'QUALIFIED', occurredAt: at(10) },
      { leadId: 'b', dealId: null, toStage: 'DISCOVERED', occurredAt: at(0) },
      { leadId: 'b', dealId: null, toStage: 'DISQUALIFIED', occurredAt: at(2) },
    ];

    const discovered = flow(rows, 'DISCOVERED');
    expect(discovered.entered).toBe(2);
    expect(discovered.progressed).toBe(1);
    expect(discovered.conversionRate).toBe(0.5);
    // a: 10h até QUALIFIED; b: 2h até DISQUALIFIED → mediana 6h
    expect(discovered.medianHoursInStage).toBe(6);
  });

  it('lead convertido e o deal de origem formam uma trajetória só', () => {
    const rows: TransitionRow[] = [
      { leadId: 'a', dealId: null, toStage: 'CONTACTED', occurredAt: at(0) },
      { leadId: 'a', dealId: 'd1', toStage: 'MEETING_SCHEDULED', occurredAt: at(48) },
      { leadId: 'a', dealId: 'd1', toStage: 'WON', occurredAt: at(96) },
    ];

    expect(flow(rows, 'CONTACTED').progressed).toBe(1);
    expect(flow(rows, 'MEETING_SCHEDULED').medianHoursInStage).toBe(48);
    expect(flow(rows, 'WON').entered).toBe(1);
    expect(flow(rows, 'WON').conversionRate).toBeNull();
  });

  it('ir para LOST não conta como avanço', () => {
    const rows: TransitionRow[] = [
      { leadId: null, dealId: 'd1', toStage: 'NEGOTIATION', occurredAt: at(0) },
      { leadId: null, dealId: 'd1', toStage: 'LOST', occurredAt: at(5) },
    ];

    expect(flow(rows, 'NEGOTIATION').conversionRate).toBe(0);
  });

  it('reentrar no mesmo estágio não conta entrada duas vezes', () => {
    const rows: TransitionRow[] = [
      { leadId: null, dealId: 'd1', toStage: 'MEETING_SCHEDULED', occurredAt: at(0) },
      { leadId: null, dealId: 'd1', toStage: 'LOST', occurredAt: at(1) },
      { leadId: null, dealId: 'd1', toStage: 'MEETING_SCHEDULED', occurredAt: at(2) },
    ];

    expect(flow(rows, 'MEETING_SCHEDULED').entered).toBe(1);
  });

  it('estágio sem amostra devolve conversão e mediana nulas, com próxima ação', () => {
    const empty = flow([], 'PREVIEW_READY');

    expect(empty.entered).toBe(0);
    expect(empty.conversionRate).toBeNull();
    expect(empty.medianHoursInStage).toBeNull();
    expect(empty.nextAction).toBeTruthy();
  });
});
