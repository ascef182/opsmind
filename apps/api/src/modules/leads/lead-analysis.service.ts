import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import type { AIRequest, AIRequestStatus, Lead, LeadEnrichment, Prisma } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { BudgetService } from '../ai/services/budget.service';
import { AI_GATEWAY, type AiGateway } from '../ai/gateway/ai-gateway.interface';

// Mesma tabela de preço de `AiService.estimateCost`/`OutreachService` —
// duplicada pelo mesmo motivo (sem import de `AiModule`, ver
// `outreach.service.ts`).
const INPUT_COST_PER_MILLION_TOKENS = 5;
const OUTPUT_COST_PER_MILLION_TOKENS = 25;

const MODEL_NAME = 'claude-opus-5';

const ANALYSIS_SYSTEM_PROMPT = [
  'Você analisa o potencial de um lead de prospecção B2B para o OpsMind, um CRM para pequenas equipes.',
  'Use APENAS os dados do lead fornecidos — nunca invente fatos, números ou firmografia que não estejam no material.',
  'Responda em português, em um parágrafo curto e direto, explicando por que este lead é (ou não) um bom alvo para a oferta de serviço da organização.',
  'Esta análise é informativa para um humano decidir se vale investir em outreach — nunca aprova, envia ou qualifica nada sozinha.',
].join(' ');

/**
 * `analyzeLeadPotential` — análise de IA opt-in POR LEAD (nunca automática
 * em massa: rodar isso sobre milhares de leads de um scrape job estouraria
 * orçamento sem controle; por isso o scoring de massa é sempre determinístico
 * via `scoreLead()`, ver `LeadsService.score`/`apps/worker/src/
 * lead-scrape-processor.ts`). Chamada de completion one-shot, sem `tools`,
 * mesmo padrão de `OutreachService.generateDraft` — e mesmo motivo para
 * `AI_GATEWAY`/`BudgetService` serem re-registrados como providers próprios
 * de `LeadsModule` em vez de importar `AiModule` (dependência circular:
 * `AiModule` importa `LeadsModule` na Task 6).
 *
 * Resultado gravado como `LeadEnrichment{type: 'ai_analysis', data: {text}}`
 * — nunca muta `Lead` diretamente (a análise é um dado adicional para um
 * humano ler, não uma alteração de estado do lead).
 */
@Injectable()
export class LeadAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly budgetService: BudgetService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async analyzeLeadPotential(
    organizationId: string,
    leadId: string,
    userId: string,
  ): Promise<LeadEnrichment> {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, organizationId } });
    if (!lead) {
      throw new NotFoundException('Lead não encontrado');
    }

    // Mesmo corte de orçamento (e mesma disciplina de persistir um
    // AIRequest BUDGET_EXCEEDED mesmo no corte) de `OutreachService
    // .generateDraft`/`AiService.chat`.
    const organization = await this.organizationsService.findById(organizationId);
    const monthlyBudget = organization?.aiMonthlyBudget ? Number(organization.aiMonthlyBudget) : null;
    if (await this.budgetService.isOverBudget(organizationId, monthlyBudget)) {
      await this.persistAiRequest(organizationId, userId, 'BUDGET_EXCEEDED', 0, 0, 0, 0);
      throw new ForbiddenException('Orçamento mensal de IA desta organização foi atingido.');
    }

    const prompt = this.buildPrompt(lead);

    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      response = await this.gateway.sendMessage({
        system: ANALYSIS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        tools: [],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      await this.persistAiRequest(organizationId, userId, 'ERROR', 0, 0, Date.now() - startedAt, 0, errorMessage);
      throw error;
    }

    const latencyMs = Date.now() - startedAt;
    const text = this.extractText(response);
    const cost = this.estimateCost(response.usage.input_tokens, response.usage.output_tokens);

    await this.persistAiRequest(
      organizationId,
      userId,
      'SUCCESS',
      response.usage.input_tokens,
      response.usage.output_tokens,
      latencyMs,
      cost,
    );
    await this.budgetService.recordSpend(organizationId, cost);

    return this.prisma.leadEnrichment.create({
      data: {
        organizationId,
        leadId,
        type: 'ai_analysis',
        data: { text } as unknown as Prisma.InputJsonValue,
        actorType: 'AI',
        actorId: null,
      },
    });
  }

  private buildPrompt(lead: Lead): string {
    const facts = [
      `Nome do negócio: ${lead.name}`,
      lead.address ? `Endereço: ${lead.address}` : '',
      lead.city || lead.state ? `Local: ${[lead.city, lead.state].filter(Boolean).join(', ')}` : '',
      lead.googleCategory ? `Categoria: ${lead.googleCategory}` : '',
      lead.rating != null ? `Avaliação: ${lead.rating} (${lead.reviewCount ?? 0} avaliações)` : '',
      lead.website ? `Site: ${lead.website}` : 'Este negócio não tem site.',
      lead.score != null ? `Score de qualificação calculado: ${lead.score}/100` : '',
      lead.rawContent ? `Texto original coletado sobre o negócio:\n${lead.rawContent}` : '',
    ].filter((line) => line !== '');

    return [
      'Dados reais do lead (fonte da verdade — não invente nada além disso):',
      ...facts,
      '',
      'Explique por que este lead é (ou não) um bom alvo de prospecção, citando os dados acima.',
    ].join('\n');
  }

  private extractText(response: Anthropic.Message): string {
    return response.content
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

  private persistAiRequest(
    organizationId: string,
    userId: string,
    status: AIRequestStatus,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    cost: number,
    errorMessage?: string,
  ): Promise<AIRequest> {
    return this.prisma.aIRequest.create({
      data: {
        organizationId,
        userId,
        model: MODEL_NAME,
        inputTokens,
        outputTokens,
        latencyMs,
        estimatedCost: cost,
        status,
        errorMessage,
      },
    });
  }
}
