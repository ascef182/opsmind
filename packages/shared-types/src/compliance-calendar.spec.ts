import {
  addDays,
  CERTIFICATE_REMINDER_OFFSETS,
  OBLIGATION_REMINDER_OFFSETS,
  certificateStatus,
  daysBetween,
  firstDueDateFrom,
  nextDueDate,
  reminderOffsetDue,
} from './compliance-calendar';

describe('daysBetween', () => {
  it('conta dias de calendário, atravessando meses e anos', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2027-03-01', '2027-02-27')).toBe(-2);
  });
});

describe('addDays', () => {
  it('soma e subtrai dias atravessando meses', () => {
    expect(addDays('2026-11-28', 7)).toBe('2026-12-05');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });
});

describe('certificateStatus', () => {
  it('VALIDA com mais de 15 dias, VENCENDO até 15, VENCIDA depois da validade', () => {
    expect(certificateStatus('2026-12-20', '2026-12-04')).toBe('VALIDA');
    expect(certificateStatus('2026-12-20', '2026-12-05')).toBe('VENCENDO');
    expect(certificateStatus('2026-12-20', '2026-12-20')).toBe('VENCENDO');
    expect(certificateStatus('2026-12-20', '2026-12-21')).toBe('VENCIDA');
  });
});

describe('nextDueDate', () => {
  it('mensal: mesmo dia do mês seguinte, com dia inexistente no último do mês', () => {
    expect(nextDueDate({ recurrence: 'MONTHLY', dueDay: 20, dueMonth: null }, '2026-12-20')).toBe('2027-01-20');
    expect(nextDueDate({ recurrence: 'MONTHLY', dueDay: 31, dueMonth: null }, '2027-01-31')).toBe('2027-02-28');
    expect(nextDueDate({ recurrence: 'MONTHLY', dueDay: 31, dueMonth: null }, '2027-02-28')).toBe('2027-03-31');
  });

  it('anual: mesmo dia e mês do ano seguinte', () => {
    expect(nextDueDate({ recurrence: 'YEARLY', dueDay: 31, dueMonth: 5 }, '2026-05-31')).toBe('2027-05-31');
    expect(nextDueDate({ recurrence: 'YEARLY', dueDay: 29, dueMonth: 2 }, '2028-02-29')).toBe('2029-02-28');
  });

  it('data única não tem próximo', () => {
    expect(nextDueDate({ recurrence: 'ONCE', dueDay: null, dueMonth: null }, '2026-12-01')).toBeNull();
  });
});

describe('reminderOffsetDue', () => {
  it('obrigação: nada antes de D-7, D-7 entre 7 e 2 dias, D-1 a partir de 1 dia', () => {
    const due = '2026-12-20';
    expect(reminderOffsetDue(due, '2026-12-12', OBLIGATION_REMINDER_OFFSETS)).toBeNull();
    expect(reminderOffsetDue(due, '2026-12-13', OBLIGATION_REMINDER_OFFSETS)).toBe(7);
    expect(reminderOffsetDue(due, '2026-12-18', OBLIGATION_REMINDER_OFFSETS)).toBe(7);
    expect(reminderOffsetDue(due, '2026-12-19', OBLIGATION_REMINDER_OFFSETS)).toBe(1);
  });

  it('scan atrasado não manda rajada: depois do vencimento, só o mais urgente', () => {
    expect(reminderOffsetDue('2026-12-20', '2026-12-25', OBLIGATION_REMINDER_OFFSETS)).toBe(1);
  });

  it('certidão: D-15 e D-0', () => {
    expect(reminderOffsetDue('2026-12-20', '2026-12-05', CERTIFICATE_REMINDER_OFFSETS)).toBe(15);
    expect(reminderOffsetDue('2026-12-20', '2026-12-19', CERTIFICATE_REMINDER_OFFSETS)).toBe(15);
    expect(reminderOffsetDue('2026-12-20', '2026-12-20', CERTIFICATE_REMINDER_OFFSETS)).toBe(0);
  });
});

describe('firstDueDateFrom', () => {
  it('mensal: este mês se ainda não passou, senão o próximo', () => {
    expect(firstDueDateFrom({ recurrence: 'MONTHLY', dueDay: 20, dueMonth: null }, '2026-11-19')).toBe('2026-11-20');
    expect(firstDueDateFrom({ recurrence: 'MONTHLY', dueDay: 20, dueMonth: null }, '2026-11-20')).toBe('2026-11-20');
    expect(firstDueDateFrom({ recurrence: 'MONTHLY', dueDay: 10, dueMonth: null }, '2026-11-19')).toBe('2026-12-10');
  });

  it('anual: este ano se ainda não passou, senão o próximo', () => {
    expect(firstDueDateFrom({ recurrence: 'YEARLY', dueDay: 31, dueMonth: 5 }, '2026-11-19')).toBe('2027-05-31');
    expect(firstDueDateFrom({ recurrence: 'YEARLY', dueDay: 31, dueMonth: 12 }, '2026-11-19')).toBe('2026-12-31');
  });
});
