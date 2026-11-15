import type { FinancialEntryView } from './finance.types';
import { FINANCIAL_CATEGORY_LABELS, FINANCIAL_SCOPE_LABELS } from '@opsmind/shared-types';

// CSV para Excel pt-BR: separador `;`, vírgula decimal, BOM UTF-8 (sem ele o
// Excel quebra os acentos). Valores em reais com 2 casas, vindos de centavos
// inteiros — nunca de ponto flutuante.
const SEPARATOR = ';';
// BOM por código (não literal no fonte) — o Excel só reconhece UTF-8 com ele.
const BOM = String.fromCharCode(0xfeff);

export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Escapa uma célula. Além das aspas do CSV, neutraliza injeção de fórmula: uma
 * descrição digitada como `=HYPERLINK(...)` viraria fórmula ao abrir no Excel.
 */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
  if (/[";\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Previsto',
  PENDING: 'Pendente',
  PARTIAL: 'Parcial',
  PAID: 'Quitado',
  CANCELLED: 'Cancelado',
  OVERDUE: 'Atrasado',
};

const HEADER = [
  'Tipo',
  'Escopo',
  'Categoria',
  'Descrição',
  'Cliente',
  'Contrato',
  'Fornecedor',
  'Emissão',
  'Vencimento',
  'Quitação',
  'Valor bruto',
  'Taxas',
  'Valor líquido',
  'Pago',
  'Em aberto',
  'Situação',
];

export function entriesToCsv(entries: FinancialEntryView[]): string {
  const lines = entries.map((e) =>
    [
      e.direction === 'INCOME' ? 'Receita' : 'Despesa',
      FINANCIAL_SCOPE_LABELS[e.scope],
      FINANCIAL_CATEGORY_LABELS[e.category],
      e.description,
      e.customerName,
      e.contractTitle,
      e.supplierName,
      e.issueDate,
      e.dueDate,
      e.settledAt,
      centsToDecimalString(e.amountCents),
      centsToDecimalString(e.feesCents),
      centsToDecimalString(e.netCents),
      centsToDecimalString(e.paidCents),
      centsToDecimalString(e.outstandingCents),
      STATUS_LABELS[e.displayStatus] ?? e.displayStatus,
    ]
      .map(csvCell)
      .join(SEPARATOR),
  );
  return `${BOM}${[HEADER.join(SEPARATOR), ...lines].join('\r\n')}\r\n`;
}
