import {
  addMonths,
  contractedCentsInRange,
  dateForMonthDay,
  displayStatus,
  estimateBrlFromForeign,
  firstBillingMonth,
  formatCentsBRL,
  isCategoryOfDirection,
  isOverdue,
  isValidDateKey,
  isValidMonthKey,
  monthlyRecurringCents,
  monthRange,
  monthsBetween,
  monthsDueForRecurring,
  outstandingCents,
  parseReaisToCents,
  quarterOf,
  recurringIssueDate,
  statusFromPaid,
  todayInSaoPaulo,
  toDateKey,
  fromDateKey,
  type ContractTerms,
} from './finance';

describe('parseReaisToCents', () => {
  it.each([
    ['249,90', 24990],
    ['249.90', 24990],
    ['1.234', 123400],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.234.567', 123456700],
    ['R$ 6.000', 600000],
    ['R$ 5.790,00', 579000],
    ['0', 0],
    ['  12 ', 1200],
  ])('lê %s como %i centavos', (input, expected) => {
    expect(parseReaisToCents(input)).toBe(expected);
  });

  it.each(['', 'abc', '-5', '12,3x', '1,2,3,x'])('recusa %p', (input) => {
    expect(parseReaisToCents(input)).toBeNull();
  });
});

describe('formatCentsBRL', () => {
  it('formata em reais', () => {
    // Intl usa NBSP entre "R$" e o número.
    expect(formatCentsBRL(579000).replace(/\s/g, ' ')).toBe('R$ 5.790,00');
  });
});

describe('estimateBrlFromForeign', () => {
  it('multiplica pela cotação e soma o IOF', () => {
    // US$ 5,00 (500 centavos) x 5,62 + R$ 1,59 de IOF = R$ 29,69.
    expect(estimateBrlFromForeign(500, 5.62, 159)).toBe(2969);
  });

  it('sem IOF informado, assume zero', () => {
    expect(estimateBrlFromForeign(2000, 5.1)).toBe(10200);
  });

  it('arredonda para o centavo mais próximo', () => {
    expect(estimateBrlFromForeign(333, 3.333)).toBe(1110);
  });
});

describe('categorias', () => {
  it('amarra categoria à direção', () => {
    expect(isCategoryOfDirection('SAAS', 'INCOME')).toBe(true);
    expect(isCategoryOfDirection('SAAS', 'EXPENSE')).toBe(false);
    expect(isCategoryOfDirection('AI', 'EXPENSE')).toBe(true);
  });
});

describe('datas e meses', () => {
  it('valida chaves', () => {
    expect(isValidMonthKey('2026-02')).toBe(true);
    expect(isValidMonthKey('2026-13')).toBe(false);
    expect(isValidDateKey('2026-02-28')).toBe(true);
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2028-02-29')).toBe(true);
    expect(isValidDateKey('2026-02-29')).toBe(false);
  });

  it('dia 31 cai no último dia do mês (nunca pula, nunca vai para o mês seguinte)', () => {
    expect(dateForMonthDay('2026-02', 31)).toBe('2026-02-28');
    expect(dateForMonthDay('2028-02', 31)).toBe('2028-02-29');
    expect(dateForMonthDay('2026-04', 31)).toBe('2026-04-30');
    expect(dateForMonthDay('2026-05', 31)).toBe('2026-05-31');
    expect(dateForMonthDay('2026-05', 5)).toBe('2026-05-05');
  });

  it('soma meses atravessando o ano', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2026-05', '2026-04')).toEqual([]);
  });

  it('intervalo de um mês e trimestre', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(quarterOf('2026-03')).toBe(1);
    expect(quarterOf('2026-04')).toBe(2);
    expect(quarterOf('2026-12')).toBe(4);
  });

  it('hoje usa o calendário de São Paulo, não o UTC', () => {
    // 01:30 UTC de 7/nov ainda é 22:30 de 6/nov em São Paulo (UTC-3).
    expect(todayInSaoPaulo(new Date('2026-11-07T01:30:00Z'))).toBe('2026-11-06');
    expect(todayInSaoPaulo(new Date('2026-11-07T03:30:00Z'))).toBe('2026-11-07');
  });

  it('converte Date <-> chave sem deslocar o dia', () => {
    expect(toDateKey(fromDateKey('2026-11-06'))).toBe('2026-11-06');
  });
});

describe('lançamentos', () => {
  const base = { amountCents: 10000, paidCents: 0 };

  it('deriva o status do valor pago', () => {
    expect(statusFromPaid({ ...base, paidCents: 0 })).toBe('PENDING');
    expect(statusFromPaid({ ...base, paidCents: 0 }, 'PLANNED')).toBe('PLANNED');
    expect(statusFromPaid({ ...base, paidCents: 4000 })).toBe('PARTIAL');
    expect(statusFromPaid({ ...base, paidCents: 10000 })).toBe('PAID');
  });

  it('saldo em aberto nunca fica negativo', () => {
    expect(outstandingCents({ amountCents: 10000, paidCents: 4000 })).toBe(6000);
    expect(outstandingCents({ amountCents: 10000, paidCents: 12000 })).toBe(0);
  });

  it('atrasado é derivado: venceu, tem saldo e não é previsto/cancelado/pago', () => {
    const today = '2026-11-06';
    expect(isOverdue({ ...base, status: 'PENDING', dueDate: '2026-11-05' }, today)).toBe(true);
    expect(isOverdue({ ...base, status: 'PENDING', dueDate: '2026-11-06' }, today)).toBe(false);
    expect(isOverdue({ ...base, status: 'PARTIAL', paidCents: 1, dueDate: '2026-10-01' }, today)).toBe(true);
    expect(isOverdue({ ...base, status: 'PLANNED', dueDate: '2026-10-01' }, today)).toBe(false);
    expect(isOverdue({ ...base, status: 'CANCELLED', dueDate: '2026-10-01' }, today)).toBe(false);
    expect(isOverdue({ amountCents: 100, paidCents: 100, status: 'PAID', dueDate: '2026-10-01' }, today)).toBe(false);
    expect(displayStatus({ ...base, status: 'PENDING', dueDate: '2026-01-01' }, today)).toBe('OVERDUE');
    expect(displayStatus({ ...base, status: 'PENDING', dueDate: '2026-12-01' }, today)).toBe('PENDING');
  });
});

describe('contratos', () => {
  const oneTime: ContractTerms = {
    billing: 'ONE_TIME',
    status: 'ACTIVE',
    valueCents: 600000,
    startDate: '2026-03-10',
    endDate: null,
    billingDay: null,
  };
  const monthly: ContractTerms = {
    billing: 'MONTHLY',
    status: 'ACTIVE',
    valueCents: 20000,
    startDate: '2026-01-10',
    endDate: null,
    billingDay: 5,
  };

  it('contrato pontual conta inteiro no período do início', () => {
    expect(contractedCentsInRange(oneTime, '2026-01-01', '2026-12-31')).toBe(600000);
    expect(contractedCentsInRange(oneTime, '2026-04-01', '2026-12-31')).toBe(0);
  });

  it('mensal: primeira cobrança é no mês seguinte quando o dia já passou do início', () => {
    // início dia 10, cobrança dia 5 -> primeira cobrança em fevereiro.
    expect(firstBillingMonth('2026-01-10', 5)).toBe('2026-02');
    expect(firstBillingMonth('2026-01-03', 5)).toBe('2026-01');
  });

  it('mensal: conta uma mensalidade por data de cobrança dentro do período', () => {
    // fev..dez = 11 cobranças em 2026.
    expect(contractedCentsInRange(monthly, '2026-01-01', '2026-12-31')).toBe(11 * 20000);
    expect(contractedCentsInRange(monthly, '2026-11-01', '2026-11-30')).toBe(20000);
  });

  it('mensal com fim respeita a vigência', () => {
    const ended = { ...monthly, endDate: '2026-04-30' };
    // fev, mar, abr.
    expect(contractedCentsInRange(ended, '2026-01-01', '2026-12-31')).toBe(3 * 20000);
  });

  it('contrato cancelado não conta', () => {
    expect(contractedCentsInRange({ ...oneTime, status: 'CANCELLED' }, '2026-01-01', '2026-12-31')).toBe(0);
    expect(contractedCentsInRange({ ...monthly, status: 'CANCELLED' }, '2026-01-01', '2026-12-31')).toBe(0);
  });

  it('MRR só soma mensais ativos e vigentes', () => {
    const list: ContractTerms[] = [
      monthly,
      { ...monthly, valueCents: 50000, status: 'CANCELLED' },
      { ...monthly, valueCents: 70000, endDate: '2026-05-01' },
      { ...monthly, valueCents: 90000, startDate: '2027-01-01' },
      oneTime,
    ];
    expect(monthlyRecurringCents(list, '2026-11-06')).toBe(20000);
  });
});

describe('recorrência', () => {
  it('gera do mês inicial até o limite, respeitando mês final e ativo', () => {
    const t = { active: true, dayOfMonth: 31, startMonth: '2026-10', endMonth: null };
    expect(monthsDueForRecurring(t, '2026-12')).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(monthsDueForRecurring({ ...t, endMonth: '2026-11' }, '2026-12')).toEqual(['2026-10', '2026-11']);
    expect(monthsDueForRecurring({ ...t, active: false }, '2026-12')).toEqual([]);
    expect(monthsDueForRecurring(t, '2026-09')).toEqual([]);
  });
});

describe('recurringIssueDate', () => {
  it('não emite no futuro', () => {
    expect(recurringIssueDate('2026-11-25', '2026-11-06')).toBe('2026-11-06');
    expect(recurringIssueDate('2026-10-25', '2026-11-06')).toBe('2026-10-25');
    expect(recurringIssueDate('2026-11-06', '2026-11-06')).toBe('2026-11-06');
  });
});
