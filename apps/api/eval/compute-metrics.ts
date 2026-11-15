import type { EvalCaseResult, EvalCategory, EvalMetrics } from './types';

const CATEGORIES: EvalCategory[] = ['tool-accuracy', 'rag-grounding', 'hallucination-judge', 'prompt-injection'];

export function computeMetrics(results: EvalCaseResult[]): EvalMetrics {
  if (results.length === 0) {
    throw new Error('computeMetrics: nenhum resultado para agregar');
  }

  const byCategory = Object.fromEntries(
    CATEGORIES.map((category) => {
      const inCategory = results.filter((r) => r.category === category);
      const passed = inCategory.filter((r) => r.passed).length;
      return [category, { passed, total: inCategory.length }];
    }),
  ) as Record<EvalCategory, { passed: number; total: number }>;

  const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
  const avgLatencyMs = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;
  const hallucinationRate = results.filter((r) => r.hallucinated).length / results.length;

  return {
    toolAccuracy: ratio(byCategory['tool-accuracy']),
    hallucinationRate,
    injectionResistance: ratio(byCategory['prompt-injection']),
    totalCost,
    avgLatencyMs,
    byCategory,
  };
}

function ratio(counts: { passed: number; total: number }): number {
  return counts.total === 0 ? 0 : counts.passed / counts.total;
}
