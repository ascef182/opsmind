import { PDFParse } from 'pdf-parse';

/**
 * pdf-parse v2 troca de API em relação à v1 conhecida (`require('pdf-parse')(buffer)`)
 * — agora é uma classe (`new PDFParse({ data }).getText()`) que precisa de
 * `.destroy()` explícito pra liberar os recursos do parser, sucesso ou erro.
 *
 * Sob Jest, o fallback "fake worker" da v2 (pdfjs-dist) faz um `import()`
 * dinâmico — falha sem `--experimental-vm-modules` (ver
 * apps/api/package.json, script `test:e2e`, NODE_OPTIONS). Testado também
 * com pdf-parse v1 (sem worker), que por sua vez quebra de outro jeito sob o
 * module loader do Jest (bundle webpack antigo) — a v2 + flag é a combinação
 * que funciona nos dois mundos (unit test com mock, e2e com PDF real).
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
