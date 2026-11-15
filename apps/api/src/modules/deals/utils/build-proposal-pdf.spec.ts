import { buildProposalPdf, type ProposalPdfInput } from './build-proposal-pdf';

function baseInput(overrides: Partial<ProposalPdfInput> = {}): ProposalPdfInput {
  return {
    dealTitle: 'Site institucional',
    customerName: 'João Silva',
    customerCompany: 'Padaria Central',
    value: '5000.00',
    currency: 'BRL',
    expectedCloseDate: new Date('2026-10-01'),
    proposalDraft: 'Escopo: criação de site institucional com 5 páginas.',
    generatedAt: new Date('2026-09-20T10:00:00Z'),
    ...overrides,
  };
}

describe('buildProposalPdf', () => {
  it('gera um PDF válido (magic bytes %PDF, trailer %%EOF)', async () => {
    const buffer = await buildProposalPdf(baseInput());

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.toString('latin1')).toMatch(/%%EOF\s*$/);
  });

  it('produz um PDF maior quando a minuta da proposta é mais longa (prova que o texto entra no documento)', async () => {
    const shortDraft = 'Proposta curta.';
    const longDraft = 'Proposta longa. '.repeat(500);

    const shortBuffer = await buildProposalPdf(baseInput({ proposalDraft: shortDraft }));
    const longBuffer = await buildProposalPdf(baseInput({ proposalDraft: longDraft }));

    expect(longBuffer.length).toBeGreaterThan(shortBuffer.length);
  });

  it('não quebra quando o cliente não tem empresa (customerCompany null)', async () => {
    const buffer = await buildProposalPdf(baseInput({ customerCompany: null }));

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('não quebra quando não há data prevista de fechamento (expectedCloseDate null)', async () => {
    const buffer = await buildProposalPdf(baseInput({ expectedCloseDate: null }));

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
