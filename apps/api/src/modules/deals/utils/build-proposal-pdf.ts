import PDFDocument from 'pdfkit';

export interface ProposalPdfInput {
  dealTitle: string;
  customerName: string;
  customerCompany: string | null;
  // `Deal.value` é `Decimal` do Prisma — já convertido para string aqui
  // (mesma decisão de `lib/deals/types.ts` no frontend: `Decimal` serializa
  // como string, e este util não deveria depender do tipo do Prisma).
  value: string;
  currency: string;
  expectedCloseDate: Date | null;
  proposalDraft: string;
  generatedAt: Date | null;
}

function formatCurrency(value: string, currency: string): string {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
  } catch {
    // `currency` fora do padrão ISO 4217 — mesmo fallback de
    // `lib/deals/types.ts` formatCurrency no frontend.
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Renderiza `Deal.proposalDraft` (texto livre, gerado por IA ou editado à
 * mão) como PDF — sprint "Proposta em PDF" (trilha de fechamento). Função
 * pura, sem I/O: `DealProposalService`/`DealsController` decidem onde a
 * proposta veio e como servir o resultado; isto só sabe transformar dados
 * já validados em bytes de PDF.
 *
 * Sem template jurídico nem geração de contrato assinável — isso é o
 * próximo passo da trilha (assinatura eletrônica). Este PDF é o mesmo
 * rascunho revisável que já existia como texto, só num formato que o
 * vendedor pode baixar e mandar pro cliente.
 */
export function buildProposalPdf(input: ProposalPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('Proposta Comercial', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(11);
    doc.text(`Cliente: ${input.customerName}${input.customerCompany ? ` (${input.customerCompany})` : ''}`);
    doc.text(`Negócio: ${input.dealTitle}`);
    doc.text(`Valor: ${formatCurrency(input.value, input.currency)}`);
    if (input.expectedCloseDate) {
      doc.text(`Previsão de fechamento: ${input.expectedCloseDate.toLocaleDateString('pt-BR')}`);
    }
    doc.moveDown(1.5);

    doc.fontSize(11).text(input.proposalDraft, { align: 'left', lineGap: 4 });
    doc.moveDown(1.5);

    if (input.generatedAt) {
      doc
        .fontSize(8)
        .fillColor('gray')
        .text(
          `Gerado em ${input.generatedAt.toLocaleString('pt-BR')} — minuta revisável, revisada por um humano antes do envio.`,
        );
    }

    doc.end();
  });
}
