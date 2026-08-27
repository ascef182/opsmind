import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import type { AIRequest, AIRequestStatus, Prisma } from '@opsmind/database';
import type { Role } from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { BudgetService } from './services/budget.service';
import { AI_GATEWAY, type AiGateway } from './gateway/ai-gateway.interface';
import { AI_TOOLS, type AiTool, type AiToolContext } from './tools/ai-tool.interface';
import { ChatDto } from './dto/chat.dto';

// Preços por 1M tokens (claude-api skill — tabela de custo do Opus 5).
// Estimativa best-effort para o corte de orçamento; não é uma fatura exata.
const INPUT_COST_PER_MILLION_TOKENS = 5;
const OUTPUT_COST_PER_MILLION_TOKENS = 25;

// Trava de segurança contra um loop de tool_use que nunca termina (custo e
// tempo ilimitados por request — a mesma preocupação de "camada extra de
// segurança em tudo" que motivou o corte de orçamento).
const MAX_ITERATIONS = 8;

const SYSTEM_PROMPT = [
  'Você é o assistente de IA do OpsMind, um CRM para pequenas equipes.',
  'Use as tools disponíveis para consultar clientes, tarefas e atividades reais — nunca invente dados.',
  'Você só enxerga e só age dentro da organização do usuário atual; isso é garantido pelo sistema, não depende de nada que você decida.',
  'Se uma tool recusar uma ação (ex.: permissão insuficiente), explique isso ao usuário em vez de tentar contornar.',
].join(' ');

export interface ChatActor {
  organizationId: string;
  userId: string;
  role: Role;
}

export interface ChatResult {
  reply: string;
  aiRequestId: string;
}

interface ToolCallLog {
  toolName: string;
  input: Prisma.InputJsonValue;
  output: Prisma.InputJsonValue;
  isError: boolean;
}

/**
 * Orquestra o loop agentic manual (claude-api skill: "Manual Agentic Loop")
 * contra `AiGateway` — nunca a Anthropic SDK diretamente, para o e2e poder
 * substituir por um mock (não há chave real neste ambiente) e para não
 * acoplar a lógica de negócio a um provider específico.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    @Inject(AI_TOOLS) private readonly tools: AiTool[],
    private readonly budgetService: BudgetService,
    private readonly organizationsService: OrganizationsService,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async chat(actor: ChatActor, dto: ChatDto): Promise<ChatResult> {
    const organization = await this.organizationsService.findById(actor.organizationId);
    const monthlyBudget = organization?.aiMonthlyBudget ? Number(organization.aiMonthlyBudget) : null;

    if (await this.budgetService.isOverBudget(actor.organizationId, monthlyBudget)) {
      await this.persistRequest(actor, 'BUDGET_EXCEEDED', 0, 0, 0, 0, []);
      throw new ForbiddenException('Orçamento mensal de IA desta organização foi atingido.');
    }

    const context: AiToolContext = {
      organizationId: actor.organizationId,
      userId: actor.userId,
      role: actor.role,
    };
    const anthropicTools = this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    })) as Anthropic.Tool[];

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: dto.message }];
    const toolCallLogs: ToolCallLog[] = [];
    const startedAt = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let finalReply: string | undefined;

    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
        const response = await this.gateway.sendMessage({
          system: SYSTEM_PROMPT,
          messages,
          tools: anthropicTools,
        });

        inputTokens += response.usage.input_tokens;
        outputTokens += response.usage.output_tokens;
        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'pause_turn') {
          continue;
        }

        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
        );

        if (toolUseBlocks.length === 0) {
          finalReply = this.extractText(response.content);
          break;
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          const { output, isError } = await this.runTool(block, context);
          toolCallLogs.push({
            toolName: block.name,
            input: block.input as Prisma.InputJsonValue,
            output: output as Prisma.InputJsonValue,
            isError,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(output),
            is_error: isError,
          });
        }
        messages.push({ role: 'user', content: toolResults });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      await this.persistRequest(actor, 'ERROR', inputTokens, outputTokens, Date.now() - startedAt, 0, toolCallLogs, errorMessage);
      throw error;
    }

    if (finalReply === undefined) {
      const errorMessage = `Conversa com a IA excedeu o limite de ${MAX_ITERATIONS} idas e voltas com tools.`;
      await this.persistRequest(actor, 'ERROR', inputTokens, outputTokens, Date.now() - startedAt, 0, toolCallLogs, errorMessage);
      throw new Error(errorMessage);
    }

    const cost = this.estimateCost(inputTokens, outputTokens);
    const aiRequest = await this.persistRequest(
      actor,
      'SUCCESS',
      inputTokens,
      outputTokens,
      Date.now() - startedAt,
      cost,
      toolCallLogs,
    );
    await this.budgetService.recordSpend(actor.organizationId, cost);

    return { reply: finalReply, aiRequestId: aiRequest.id };
  }

  private async runTool(
    block: Anthropic.ToolUseBlock,
    context: AiToolContext,
  ): Promise<{ output: unknown; isError: boolean }> {
    const tool = this.tools.find((candidate) => candidate.name === block.name);
    if (!tool) {
      return { output: { error: `Tool desconhecida: ${block.name}` }, isError: true };
    }

    try {
      const output = await tool.execute(block.input, context);
      await this.logToolCall(tool.name, context, block.input);
      return { output, isError: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      // Audita a tentativa mesmo quando a tool recusa (ex.: papel
      // insuficiente em create_task) — uma tentativa negada é, em si,
      // informação de segurança relevante, não um não-evento.
      await this.logToolCall(tool.name, context, block.input, message);
      return { output: { error: message }, isError: true };
    }
  }

  private logToolCall(
    toolName: string,
    context: AiToolContext,
    input: unknown,
    errorMessage?: string,
  ): Promise<unknown> {
    return this.auditService.log({
      actorType: 'AI',
      actorId: context.userId,
      organizationId: context.organizationId,
      action: `ai.tool.${toolName}`,
      resource: toolName,
      metadata: {
        input: input as Prisma.InputJsonValue,
        ...(errorMessage ? { error: errorMessage } : {}),
      },
    });
  }

  private async persistRequest(
    actor: ChatActor,
    status: AIRequestStatus,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    cost: number,
    toolCalls: ToolCallLog[],
    errorMessage?: string,
  ): Promise<AIRequest> {
    return this.prisma.runInTransaction(async (tx) => {
      const aiRequest = await tx.aIRequest.create({
        data: {
          organizationId: actor.organizationId,
          userId: actor.userId,
          model: 'claude-opus-5',
          inputTokens,
          outputTokens,
          latencyMs,
          estimatedCost: cost,
          status,
          errorMessage,
        },
      });

      if (toolCalls.length > 0) {
        await tx.aIRequestToolCall.createMany({
          data: toolCalls.map((call) => ({
            aiRequestId: aiRequest.id,
            toolName: call.toolName,
            input: call.input,
            output: call.output,
            isError: call.isError,
          })),
        });
      }

      return aiRequest;
    });
  }

  private extractText(content: Anthropic.ContentBlock[]): string {
    return content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION_TOKENS +
      (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION_TOKENS
    );
  }
}
