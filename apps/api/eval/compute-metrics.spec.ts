import { computeMetrics } from './compute-metrics';
import type { EvalCaseResult } from './types';

function result(overrides: Partial<EvalCaseResult>): EvalCaseResult {
  return {
    id: 'case-1',
    category: 'tool-accuracy',
    passed: true,
    hallucinated: false,
    cost: 0.01,
    latencyMs: 500,
    ...overrides,
  };
}

describe('computeMetrics', () => {
  it('calcula tool accuracy só sobre os casos tool-accuracy', () => {
    const results = [
      result({ id: 't1', category: 'tool-accuracy', passed: true }),
      result({ id: 't2', category: 'tool-accuracy', passed: false }),
      result({ id: 'r1', category: 'rag-grounding', passed: true }),
    ];

    const metrics = computeMetrics(results);

    expect(metrics.toolAccuracy).toBe(0.5);
    expect(metrics.byCategory['tool-accuracy']).toEqual({ passed: 1, total: 2 });
  });

  it('calcula hallucination rate sobre TODOS os casos, não só a categoria hallucination-judge', () => {
    const results = [
      result({ id: 't1', category: 'tool-accuracy', hallucinated: true }),
      result({ id: 'h1', category: 'hallucination-judge', hallucinated: false }),
    ];

    expect(computeMetrics(results).hallucinationRate).toBe(0.5);
  });

  it('calcula injection resistance só sobre os casos prompt-injection', () => {
    const results = [
      result({ id: 'i1', category: 'prompt-injection', passed: true }),
      result({ id: 'i2', category: 'prompt-injection', passed: true }),
      result({ id: 't1', category: 'tool-accuracy', passed: false }),
    ];

    expect(computeMetrics(results).injectionResistance).toBe(1);
  });

  it('soma custo total e calcula latência média', () => {
    const results = [
      result({ id: 'a', cost: 0.01, latencyMs: 400 }),
      result({ id: 'b', cost: 0.02, latencyMs: 600 }),
    ];

    const metrics = computeMetrics(results);

    expect(metrics.totalCost).toBeCloseTo(0.03);
    expect(metrics.avgLatencyMs).toBe(500);
  });

  it('categoria sem nenhum caso tem ratio 0, não NaN', () => {
    const results = [result({ id: 't1', category: 'tool-accuracy' })];

    expect(computeMetrics(results).injectionResistance).toBe(0);
  });

  it('lança erro claro se a lista de resultados for vazia', () => {
    expect(() => computeMetrics([])).toThrow('nenhum resultado');
  });
});
