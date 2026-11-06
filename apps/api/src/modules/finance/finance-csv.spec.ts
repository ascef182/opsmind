import { centsToDecimalString, csvCell, entriesToCsv } from './finance-csv';
import type { FinancialEntryView } from './finance.types';

describe('centsToDecimalString', () => {
  it.each([
    [0, '0,00'],
    [5, '0,05'],
    [24990, '249,90'],
    [579000, '5790,00'],
    [-1050, '-10,50'],
  ])('%i -> %s', (cents, expected) => {
    expect(centsToDecimalString(cents)).toBe(expected);
  });
});

describe('csvCell', () => {
  it('escapa aspas, separador e quebra de linha', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"');
  });

  it('neutraliza injeção de fórmula em texto digitado', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+55 11 99999')).toBe("'+55 11 99999");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('número negativo de verdade não é "neutralizado" (só texto livre é)', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });
});

describe('entriesToCsv', () => {
  const entry: FinancialEntryView = {
    id: '1',
    direction: 'INCOME',
    category: 'PROJECT',
    scope: 'BUSINESS',
    description: 'Site; fase 1',
    supplierName: null,
    customerId: 'c',
    customerName: 'ORTHOESP',
    contractId: null,
    contractTitle: null,
    recurringEntryId: null,
    referenceMonth: null,
    amountCents: 300000,
    feesCents: 1500,
    netCents: 298500,
    foreignCurrency: null,
    foreignAmountCents: null,
    exchangeRate: null,
    iofCents: null,
    paidCents: 100000,
    outstandingCents: 200000,
    status: 'PARTIAL',
    displayStatus: 'OVERDUE',
    issueDate: '2026-10-01',
    dueDate: '2026-10-10',
    settledAt: null,
    cancelledAt: null,
    cancelReason: null,
    notes: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  };

  it('começa com BOM, usa ; e formata reais a partir de centavos', () => {
    const csv = entriesToCsv([entry]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = csv.slice(1).split('\r\n');
    expect(header).toContain('Valor bruto;Taxas');
    expect(header).toContain('Tipo;Escopo;Categoria');
    expect(row).toBe('Receita;Empresa (CNPJ);Projeto;"Site; fase 1";ORTHOESP;;;2026-10-01;2026-10-10;;3000,00;15,00;2985,00;1000,00;2000,00;Atrasado');
  });

  it('lançamento pessoal exporta "Pessoal" na coluna de escopo', () => {
    const csv = entriesToCsv([{ ...entry, scope: 'PERSONAL' }]);
    const [, row] = csv.slice(1).split('\r\n');
    expect(row).toMatch(/^Receita;Pessoal;Projeto/);
  });
});
