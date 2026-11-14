import { attachDealRisk } from './deal-risk.util';

describe('attachDealRisk', () => {
  it('calcula NOT_APPLICABLE para um deal em WON', () => {
    const deal = { id: 'd1', stage: 'WON', stageEnteredAt: new Date('2000-01-01') } as never;
    expect(attachDealRisk(deal).risk).toBe('NOT_APPLICABLE');
  });

  it('preserva todos os campos originais do Deal no retorno', () => {
    const deal = { id: 'd1', stage: 'QUALIFICATION', stageEnteredAt: new Date(), title: 'Contrato X' } as never;
    const result = attachDealRisk(deal);
    expect(result.id).toBe('d1');
    expect(result.title).toBe('Contrato X');
  });
});
