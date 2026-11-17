import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { recordCostEvent, type AIRequest, type AIRequestStatus } from '@opsmind/database';
import { AI_MODEL_LABEL_UNKNOWN, estimateAiCostUsd } from '@opsmind/shared-types';
import { PrismaOutOfBandService } from '../../../infrastructure/database/prisma-out-of-band.service';
import {
  AI_GATEWAY,
  type AiEffort,
  type AiGateway,
  type AiModelTier,
} from '../gateway/ai-gateway.interface';
import { BudgetService } from './budget.service';

// `AI`: job autônomo sem humano nem gatilho de sistema por trás (ex.:
// clustering de Reddit), mesma atribuição que esses jobs já usam no AuditLog.
export type AiRunActor = { type: 'USER'; userId: string } | { type: 'SYSTEM' } | { type: 'AI' };

export interface AiOneShotInput {
  organizationId: string;
  // `Organization.aiMonthlyBudget` já lido pelo chamador (null = sem teto).
  monthlyBudget: number | null;
  // Nome estável da operação de produto (`outreach.draft`, `deal.proposal`):
  // vai para `AIRequest.operation` e `CostEvent.operation`.
  operation: string;
  agent?: string;
  actor: AiRunActor;
  system: string;
  prompt: string;
  tier?: AiModelTier;
  maxTokens?: number;
  effort?: AiEffort;
  leadId?: string | null;
  dealId?: string | null;
}

export interface AiOneShotResult {
  text: string;
  model: string;
  costUsd: number;
  aiRequest: AIRequest;
}

export class AiBudgetExceededException extends ForbiddenException {
  constructor() {
    super('Orçamento mensal de IA desta organização foi atingido.');
  }
}

export class AiRefusalException extends Error {
  constructor(operation: string) {
    super(`A IA recusou a operação ${operation}.`);
  }
}

/**
 * Uma chamada única ao gateway (sem tools, sem loop) com toda a contabilidade
 * em volta: corte de orçamento antes de gastar, `AIRequest` em toda tentativa
 * (sucesso, erro, corte), débito no orçamento e linha na razão de custos.
 * Antes isso era copiado à mão em quatro services, e a cópia de proposta
 * esquecia de debitar o orçamento.
 *
 * `AIRequest` e `CostEvent` são gravados fora da transação da request
 * (`PrismaOutOfBandService`): o custo é real mesmo se o chamador reverter o
 * que fez com o texto.
 */
@Injectable()
export class AiOneShotRunner {
  constructor(
    private readonly prismaOutOfBand: PrismaOutOfBandService,
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly budgetService: BudgetService,
  ) {}

  async run(input: AiOneShotInput): Promise<AiOneShotResult> {
    if (await this.budgetService.isOverBudget(input.organizationId, input.monthlyBudget)) {
      await this.persist(input, { status: 'BUDGET_EXCEEDED' });
      throw new AiBudgetExceededException();
    }

    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      response = await this.gateway.sendMessage({
        system: input.system,
        messages: [{ role: 'user', content: input.prompt }],
        tools: [],
        ...(input.tier ? { tier: input.tier } : {}),
        ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
      });
    } catch (error) {
      await this.persist(input, {
        status: 'ERROR',
        latencyMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : 'Erro desconhecido',
      });
      throw error;
    }

    const costUsd = estimateAiCostUsd(
      response.model,
      response.usage.input_tokens,
      response.usage.output_tokens,
    );
    const refused = response.stop_reason === 'refusal';
    const aiRequest = await this.persist(input, {
      status: refused ? 'ERROR' : 'SUCCESS',
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
      costUsd,
      errorMessage: refused ? 'refusal' : undefined,
    });
    await this.budgetService.recordSpend(input.organizationId, costUsd);

    if (refused) {
      throw new AiRefusalException(input.operation);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    return { text, model: response.model, costUsd, aiRequest };
  }

  private persist(
    input: AiOneShotInput,
    outcome: {
      status: AIRequestStatus;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      latencyMs?: number;
      costUsd?: number;
      errorMessage?: string;
    },
  ): Promise<AIRequest> {
    const userId = input.actor.type === 'USER' ? input.actor.userId : null;
    const costUsd = outcome.costUsd ?? 0;
    return this.prismaOutOfBand.runOutsideTransaction(input.organizationId, async (tx) => {
      const aiRequest = await tx.aIRequest.create({
        data: {
          organizationId: input.organizationId,
          userId,
          actorType: input.actor.type,
          actorId: userId,
          operation: input.operation,
          model: outcome.model ?? AI_MODEL_LABEL_UNKNOWN,
          inputTokens: outcome.inputTokens ?? 0,
          outputTokens: outcome.outputTokens ?? 0,
          latencyMs: outcome.latencyMs ?? 0,
          estimatedCost: costUsd,
          status: outcome.status,
          errorMessage: outcome.errorMessage,
        },
      });
      await recordCostEvent(tx, {
        organizationId: input.organizationId,
        category: 'AI',
        provider: 'anthropic',
        operation: input.operation,
        agent: input.agent,
        amountUsd: costUsd,
        leadId: input.leadId,
        dealId: input.dealId,
        aiRequestId: aiRequest.id,
      });
      return aiRequest;
    });
  }
}
