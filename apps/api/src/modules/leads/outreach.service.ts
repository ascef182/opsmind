import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  AIRequest,
  AIRequestStatus,
  Lead,
  OutreachMessage,
  OutreachStatus,
  Prisma,
  ServiceOffering,
} from '@opsmind/database';
import type { LeadScoreBreakdown } from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { BudgetService } from '../ai/services/budget.service';
import { AI_GATEWAY, type AiGateway } from '../ai/gateway/ai-gateway.interface';
import { LeadsService } from './leads.service';
import { ServiceOfferingsService } from './service-offerings.service';
import { GenerateOutreachDto } from './dto/generate-outreach.dto';
import { RejectOutreachDto } from './dto/reject-outreach.dto';

// Mesma tabela de preço usada em `AiService.estimateCost` — mantida
// duplicada (não extraída para um util compartilhado) porque `LeadsModule`
// não pode importar `AiModule`: `AiModule` importa `LeadsModule` (Task 6),
// nunca o inverso, para evitar dependência circular entre os módulos (por
// isso `AI_GATEWAY`/`BudgetService` são re-registrados como providers
// próprios deste módulo — ver `leads.module.ts`).
const INPUT_COST_PER_MILLION_TOKENS = 5;
const OUTPUT_COST_PER_MILLION_TOKENS = 25;

const MODEL_NAME = 'claude-opus-5';

// Status de Lead anteriores a OUTREACH_DRAFTED — só nesses casos
// `generateDraft` avança `lead.status`, nunca regride um lead que já passou
// dessa etapa (ex.: um lead já CONTACTED não "volta" para OUTREACH_DRAFTED
// só porque um regenerate gerou um novo rascunho).
const PRE_OUTREACH_DRAFTED_STATUSES: Lead['status'][] = ['DISCOVERED', 'QUALIFIED', 'DISQUALIFIED'];

const OUTREACH_SYSTEM_PROMPT = [
  'Você escreve rascunhos de mensagens de prospecção (outreach) para o OpsMind, um CRM para pequenas equipes.',
  'O alvo típico é um negócio local que NÃO TEM SITE — cite dados reais do lead (categoria, avaliações, endereço, ausência de site, ou sinais/evidências já identificados) para justificar o contato, nunca invente fatos, dados ou citações que não estejam no material fornecido.',
  'O rascunho gerado é sempre revisado por um humano antes de ser aprovado ou enviado; escreva como uma sugestão, não como uma mensagem já pronta para disparo automático.',
  'Seja direto, respeitoso e específico ao canal informado (ex.: WhatsApp é mais informal que email; telefone deve soar como um roteiro curto de ligação).',
].join(' ');

/**
 * Máquina de estado de aprovação humana de `OutreachMessage`:
 * `DRAFT --approve--> APPROVED --markSent--> SENT --markReplied--> REPLIED`,
 * `DRAFT --reject--> REJECTED`, `DRAFT --regenerate--> (REJECTED + novo DRAFT)`.
 *
 * Regra dura do PRD desta feature: o único caminho para `status` sair de
 * `DRAFT` é por uma dessas transições, cada uma exigindo um `userId` vindo de
 * uma request HTTP autenticada e passando por `RolesGuard` no controller —
 * não existe (e não pode existir) nenhuma AI tool que chame `approve`/
 * `markSent` diretamente. `generateDraft` é a única transição que a IA
 * dispara, e ela só cria uma linha em `DRAFT`, nunca além disso.
 *
 * Adaptado quase verbatim de
 * `../feat-prospecting-outbound/apps/api/src/modules/prospecting/outreach.service.ts`
 * — mesmo state machine/`applyTransition`, mesma chamada de IA one-shot sem
 * tools. Trocado: `OutreachChannel`/prompt de sistema (negócio sem site em
 * vez de post de Reddit) e a extração de evidência (`lead.scoreBreakdown
 * .matchedSignals`, calculado por `scoreLead()`, no lugar de
 * `lead.matchedSignals` por offering do branch antigo).
 *
 * Sem repository layer — chama `PrismaService` diretamente, mesmo padrão de
 * `CustomersService`/`LeadsService`.
 */
@Injectable()
export class OutreachService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_GATEWAY) private readonly gateway: AiGateway,
    private readonly budgetService: BudgetService,
    private readonly organizationsService: OrganizationsService,
    private readonly auditService: AuditService,
    private readonly leadsService: LeadsService,
    private readonly serviceOfferingsService: ServiceOfferingsService,
  ) {}

  // `userId`: quem pediu a geração (chamador humano, via RolesGuard) — não é
  // gravado em `OutreachMessage.actorId` (`actorType` é sempre `AI` aqui:
  // quem gera o rascunho nunca é um humano diretamente), mas É gravado em
  // `AIRequest.userId`, mesma trilha de custo/observabilidade por usuário
  // que `AiService.chat` já mantém.
  async generateDraft(
    organizationId: string,
    leadId: string,
    dto: GenerateOutreachDto,
    userId: string,
  ): Promise<OutreachMessage> {
    const lead = await this.leadsService.findByIdOrThrow(organizationId, leadId);

    const offeringId = dto.serviceOfferingId ?? lead.suggestedOfferingId ?? undefined;
    if (!offeringId) {
      throw new BadRequestException(
        'Lead ainda não foi pontuado/qualificado e nenhuma oferta foi especificada.',
      );
    }
    const offering = await this.serviceOfferingsService.findByIdOrThrow(organizationId, offeringId);

    // Corte de orçamento **antes** de gastar qualquer coisa com a IA — esta
    // chamada não passa pelo loop de `AiService.chat`, então precisa repetir
    // a mesma checagem aqui (ver ai.service.ts:chat + budget.service.ts).
    // Mesma disciplina de `AiService.chat`: persiste um `AIRequest`
    // BUDGET_EXCEEDED (0 tokens/custo) mesmo no corte — dá visibilidade de
    // "quantas tentativas foram bloqueadas" na mesma tabela de
    // observabilidade, sem custo real associado.
    const organization = await this.organizationsService.findById(organizationId);
    const monthlyBudget = organization?.aiMonthlyBudget ? Number(organization.aiMonthlyBudget) : null;
    if (await this.budgetService.isOverBudget(organizationId, monthlyBudget)) {
      await this.persistAiRequest(organizationId, userId, 'BUDGET_EXCEEDED', 0, 0, 0, 0);
      throw new ForbiddenException('Orçamento mensal de IA desta organização foi atingido.');
    }

    const evidenceQuotes = this.extractEvidenceQuotes(lead);
    const prompt = this.buildPrompt(lead, offering, dto.channel, evidenceQuotes);

    // Chamada de completion única e direta ao gateway — sem `tools`, sem
    // loop de iterações (diferente de `AiService.chat`). A IA não tem como
    // chamar de volta nada além de produzir texto aqui.
    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      response = await this.gateway.sendMessage({
        system: OUTREACH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        tools: [],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      await this.persistAiRequest(organizationId, userId, 'ERROR', 0, 0, Date.now() - startedAt, 0, errorMessage);
      throw error;
    }

    const latencyMs = Date.now() - startedAt;
    const body = this.extractText(response);
    const cost = this.estimateCost(response.usage.input_tokens, response.usage.output_tokens);

    // Cria o AIRequest ANTES do OutreachMessage para poder linkar
    // `OutreachMessage.aiRequestId` já na criação (observabilidade de custo
    // por lead — o campo é documentado no schema para exatamente isso).
    const aiRequest = await this.persistAiRequest(
      organizationId,
      userId,
      'SUCCESS',
      response.usage.input_tokens,
      response.usage.output_tokens,
      latencyMs,
      cost,
    );

    const message = await this.prisma.outreachMessage.create({
      data: {
        organizationId,
        leadId,
        serviceOfferingId: offeringId,
        channel: dto.channel,
        body,
        evidenceQuotes: evidenceQuotes as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
        generatedByModel: MODEL_NAME,
        aiRequestId: aiRequest.id,
        actorType: 'AI',
        actorId: null,
      },
    });

    await this.budgetService.recordSpend(organizationId, cost);

    if (PRE_OUTREACH_DRAFTED_STATUSES.includes(lead.status)) {
      await this.prisma.lead.update({ where: { id: leadId }, data: { status: 'OUTREACH_DRAFTED' } });
    }

    return message;
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<OutreachMessage> {
    const message = await this.prisma.outreachMessage.findFirst({
      where: { id, organizationId },
    });
    if (!message) {
      throw new NotFoundException('Mensagem de outreach não encontrada');
    }
    return message;
  }

  listForLead(organizationId: string, leadId: string): Promise<OutreachMessage[]> {
    return this.prisma.outreachMessage.findMany({
      where: { organizationId, leadId },
      orderBy: { createdAt: 'desc' },
    });
  }

  list(organizationId: string, status?: OutreachStatus): Promise<OutreachMessage[]> {
    return this.prisma.outreachMessage.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approve(organizationId: string, messageId: string, userId: string): Promise<OutreachMessage> {
    await this.findByIdOrThrow(organizationId, messageId);

    const updated = await this.applyTransition(
      organizationId,
      messageId,
      'DRAFT',
      { status: 'APPROVED', approvedByUserId: userId, approvedAt: new Date() },
      'aprovar',
    );
    await this.prisma.lead.update({ where: { id: updated.leadId }, data: { status: 'OUTREACH_APPROVED' } });

    await this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action: 'outreach.approve',
      resource: messageId,
    });

    return updated;
  }

  async reject(
    organizationId: string,
    messageId: string,
    dto: RejectOutreachDto,
    userId: string,
  ): Promise<OutreachMessage> {
    await this.findByIdOrThrow(organizationId, messageId);

    const updated = await this.applyTransition(
      organizationId,
      messageId,
      'DRAFT',
      { status: 'REJECTED', rejectedReason: dto.reason },
      'rejeitar',
    );

    await this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action: 'outreach.reject',
      resource: messageId,
      ...(dto.reason ? { metadata: { reason: dto.reason } } : {}),
    });

    return updated;
  }

  // Só a partir de DRAFT (mesma guarda de `reject`) — regenerar uma mensagem
  // já APPROVED/SENT/REPLIED seria, na prática, um jeito indireto de
  // "desaprovar"/"desfazer" uma decisão humana já tomada, o que violaria a
  // mesma máquina de estado que `reject` já protege.
  async regenerate(organizationId: string, messageId: string, userId: string): Promise<OutreachMessage> {
    const message = await this.findByIdOrThrow(organizationId, messageId);

    await this.applyTransition(
      organizationId,
      messageId,
      'DRAFT',
      { status: 'REJECTED', rejectedReason: 'regenerated' },
      'regenerar',
    );

    await this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action: 'outreach.regenerate',
      resource: messageId,
    });

    return this.generateDraft(
      organizationId,
      message.leadId,
      { channel: message.channel, serviceOfferingId: message.serviceOfferingId ?? undefined },
      userId,
    );
  }

  async markSent(organizationId: string, messageId: string, userId: string): Promise<OutreachMessage> {
    await this.findByIdOrThrow(organizationId, messageId);

    const updated = await this.applyTransition(
      organizationId,
      messageId,
      'APPROVED',
      { status: 'SENT', sentAt: new Date() },
      'marcar como enviada',
    );
    await this.prisma.lead.update({ where: { id: updated.leadId }, data: { status: 'CONTACTED' } });

    await this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action: 'outreach.mark-sent',
      resource: messageId,
    });

    return updated;
  }

  async markReplied(organizationId: string, messageId: string, userId: string): Promise<OutreachMessage> {
    await this.findByIdOrThrow(organizationId, messageId);

    const updated = await this.applyTransition(
      organizationId,
      messageId,
      'SENT',
      { status: 'REPLIED', repliedAt: new Date() },
      'marcar como respondida',
    );
    await this.prisma.lead.update({ where: { id: updated.leadId }, data: { status: 'REPLIED' } });

    await this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action: 'outreach.mark-replied',
      resource: messageId,
    });

    return updated;
  }

  /**
   * Escreve a transição de status de forma condicional — `status:
   * fromStatus` entra no `WHERE` do próprio UPDATE (`updateMany`, a única
   * forma do Prisma expressar um `UPDATE ... WHERE status = $1` atômico no
   * banco), não numa checagem em código separada de uma leitura anterior.
   *
   * Isso fecha uma race real de TOCTOU: sob READ COMMITTED, duas requests
   * concorrentes (ex.: approve e reject no mesmo DRAFT) podiam ambas ler
   * DRAFT, ambas passar por uma checagem em memória, e ambas escrever —
   * a última a commitar vencia incondicionalmente, deixando uma mensagem
   * "aprovada" que um humano acabou de rejeitar (ou vice-versa). Com o
   * status na cláusula WHERE do UPDATE, só a primeira transição a
   * commitar de fato casa a linha; a segunda vê `count === 0` e recebe o
   * mesmo BadRequestException que uma transição inválida "de verdade" —
   * do ponto de vista de quem chamou, os dois casos significam a mesma
   * coisa: "essa transição não é válida agora".
   *
   * A checagem de "mensagem existe nesta org" continua sendo um
   * `findByIdOrThrow` (404) feito ANTES desta chamada, em cada método
   * público — 404 (não existe) e 400 (existe, mas não pode fazer essa
   * transição agora) são sinais diferentes para quem chamou.
   */
  private async applyTransition(
    organizationId: string,
    messageId: string,
    fromStatus: OutreachStatus,
    data: Prisma.OutreachMessageUncheckedUpdateManyInput,
    action: string,
  ): Promise<OutreachMessage> {
    const { count } = await this.prisma.outreachMessage.updateMany({
      where: { id: messageId, organizationId, status: fromStatus },
      data,
    });

    if (count === 0) {
      // Não confiar em nenhum status lido antes desta chamada (pode estar
      // desatualizado pela própria race que este método existe para
      // fechar) — relê o estado atual só para compor uma mensagem de erro
      // mais útil, nunca para decidir se a transição vale.
      const current = await this.prisma.outreachMessage.findFirst({
        where: { id: messageId, organizationId },
      });
      throw new BadRequestException(
        `Não é possível ${action} uma mensagem com status ${current?.status ?? 'desconhecido'} (esperado ${fromStatus}).`,
      );
    }

    // `findFirst` (não `findUnique`) para manter o mesmo filtro por
    // `organizationId` de todo o resto do service, embora `count > 0` já
    // garanta que a linha existe e pertence a esta organização.
    const updated = await this.prisma.outreachMessage.findFirst({
      where: { id: messageId, organizationId },
    });
    if (!updated) {
      throw new NotFoundException('Mensagem de outreach não encontrada');
    }
    return updated;
  }

  // `Lead.scoreBreakdown` é o `LeadScoreBreakdown` gravado por
  // `LeadsService.score()`/`apps/worker/src/lead-scrape-processor.ts` — os
  // `matchedSignals` da offering vencedora servem de evidência citável no
  // rascunho, mesmo papel que `matchedSignals` por offering fazia no branch
  // antigo (mas sem "quotes" separados, pois `scoreLead()` não os produz).
  private extractEvidenceQuotes(lead: Lead): string[] {
    const breakdown = lead.scoreBreakdown as unknown as LeadScoreBreakdown | null;
    return breakdown?.matchedSignals ?? [];
  }

  private buildPrompt(
    lead: Lead,
    offering: ServiceOffering,
    channel: string,
    evidenceQuotes: string[],
  ): string {
    const quotesText =
      evidenceQuotes.length > 0
        ? evidenceQuotes.map((q) => `- ${q}`).join('\n')
        : '(nenhum sinal específico foi extraído automaticamente — baseie-se apenas nos dados do negócio abaixo)';

    const leadFacts = [
      `Nome do negócio: ${lead.name}`,
      lead.address ? `Endereço: ${lead.address}` : '',
      lead.city || lead.state ? `Local: ${[lead.city, lead.state].filter(Boolean).join(', ')}` : '',
      lead.googleCategory ? `Categoria: ${lead.googleCategory}` : '',
      lead.rating != null ? `Avaliação: ${lead.rating} (${lead.reviewCount ?? 0} avaliações)` : '',
      lead.website ? `Site: ${lead.website}` : 'Este negócio NÃO TEM SITE — este é o principal motivo do contato.',
      lead.rawContent ? `Texto original coletado sobre o negócio:\n${lead.rawContent}` : '',
    ].filter((line) => line !== '');

    return [
      `Canal de contato: ${channel}`,
      '',
      `Oferta de serviço a divulgar: ${offering.name}`,
      offering.description ? `Descrição da oferta: ${offering.description}` : '',
      '',
      'Dados reais do lead (fonte da verdade — não invente nada além disso):',
      ...leadFacts,
      '',
      'Evidências/sinais já identificados que conectam este lead à oferta:',
      quotesText,
      '',
      'Escreva um rascunho de mensagem de prospecção para este canal, citando os dados reais acima para mostrar que o contato é personalizado (não genérico). Não invente fatos, números ou citações que não estejam no material fornecido.',
    ]
      .filter((line) => line !== '')
      .join('\n');
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

  // Mesmo formato de `AIRequest` que `AiService.persistRequest` grava — sem
  // `AIRequestToolCall` (este fluxo nunca chama tools) e sem envolver
  // explicitamente `runInTransaction`: já roda dentro da transação
  // ambiente por request aberta por `TenantContextInterceptor`, então um
  // `create` simples já participa dela.
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
