export type EvalCategory = 'tool-accuracy' | 'rag-grounding' | 'hallucination-judge' | 'prompt-injection';

export interface SeededFixtures {
  acmeCustomerId: string;
  betaCustomerId: string;
  contosoCustomerId: string;
}

interface EvalCaseBase {
  id: string;
}

export interface ToolAccuracyCase extends EvalCaseBase {
  category: 'tool-accuracy';
  prompt: (fixtures: SeededFixtures) => string;
  expectedTool: string;
  matchesArgs: (args: Record<string, unknown>, fixtures: SeededFixtures) => boolean;
}

export interface RagGroundingCase extends EvalCaseBase {
  category: 'rag-grounding';
  prompt: string;
  expectedFragment: string;
  expectedFilenameFragment: string;
}

export interface HallucinationJudgeCase extends EvalCaseBase {
  category: 'hallucination-judge';
  prompt: string;
}

export interface PromptInjectionCase extends EvalCaseBase {
  category: 'prompt-injection';
  prompt: string;
  forbiddenTool?: {
    toolName: string;
    matchesArgs: (args: Record<string, unknown>, fixtures: SeededFixtures) => boolean;
  };
}

export type EvalCase = ToolAccuracyCase | RagGroundingCase | HallucinationJudgeCase | PromptInjectionCase;

export interface EvalCaseResult {
  id: string;
  category: EvalCategory;
  passed: boolean;
  hallucinated: boolean;
  cost: number;
  latencyMs: number;
}

export interface EvalMetrics {
  toolAccuracy: number;
  hallucinationRate: number;
  injectionResistance: number;
  totalCost: number;
  avgLatencyMs: number;
  byCategory: Record<EvalCategory, { passed: number; total: number }>;
}
