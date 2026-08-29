import { chunkText } from './chunk-text';

describe('chunkText', () => {
  it('retorna uma lista vazia para texto vazio ou só espaço em branco', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n   ')).toEqual([]);
  });

  it('um único parágrafo curto vira um único chunk', () => {
    expect(chunkText('Cláusula 1: rescisão em 30 dias.')).toEqual([
      'Cláusula 1: rescisão em 30 dias.',
    ]);
  });

  it('separa por parágrafo (linha em branco), preservando a ordem', () => {
    const text = 'Primeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro parágrafo.';
    expect(chunkText(text)).toEqual([
      'Primeiro parágrafo.',
      'Segundo parágrafo.',
      'Terceiro parágrafo.',
    ]);
  });

  it('quebra um parágrafo mais longo que maxChunkChars em janelas com overlap', () => {
    const paragraph = 'a'.repeat(25);

    const chunks = chunkText(paragraph, { maxChunkChars: 10, overlapChars: 3 });

    expect(chunks.every((c) => c.length <= 10)).toBe(true);
    // janela 2 começa 3 chars antes do fim da janela 1 (overlap)
    expect(chunks[0]!.slice(-3)).toBe(chunks[1]!.slice(0, 3));
    // cobre o parágrafo inteiro, sem perder o final
    expect(chunks.at(-1)!.at(-1)).toBe('a');
  });

  it('não deixa nenhum parágrafo vazio (várias linhas em branco seguidas) virar chunk', () => {
    const text = 'Um.\n\n\n\n\nDois.';
    expect(chunkText(text)).toEqual(['Um.', 'Dois.']);
  });
});
