export interface ChunkOptions {
  maxChunkChars?: number;
  overlapChars?: number;
}

// PRD §13: "chunking (por parágrafo/tamanho fixo com overlap)". Parágrafo é
// a unidade natural — preserva contexto semântico melhor que uma janela cega
// —, mas um parágrafo maior que o limite (ex.: um bloco de texto sem quebra
// de linha num PDF mal formatado) cai para janela fixa com overlap, pra
// nenhum chunk estourar o limite de tokens de input do modelo de embedding.
const DEFAULT_MAX_CHUNK_CHARS = 1000;
const DEFAULT_OVERLAP_CHARS = 150;

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChunkChars) {
      chunks.push(paragraph);
      continue;
    }

    let start = 0;
    while (start < paragraph.length) {
      const end = Math.min(start + maxChunkChars, paragraph.length);
      chunks.push(paragraph.slice(start, end));
      if (end === paragraph.length) {
        break;
      }
      start = end - overlapChars;
    }
  }

  return chunks;
}
