import { EVAL_DATASET } from './dataset';

describe('EVAL_DATASET', () => {
  it('tem exatamente 16 casos', () => {
    expect(EVAL_DATASET).toHaveLength(16);
  });

  it('tem a distribuição de categorias do design (8 tool-accuracy, 4 rag-grounding, 2 hallucination-judge, 2 prompt-injection)', () => {
    const counts = EVAL_DATASET.reduce<Record<string, number>>((acc, c) => {
      acc[c.category] = (acc[c.category] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts).toEqual({
      'tool-accuracy': 8,
      'rag-grounding': 4,
      'hallucination-judge': 2,
      'prompt-injection': 2,
    });
  });

  it('todo id de caso é único', () => {
    const ids = EVAL_DATASET.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
