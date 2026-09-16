import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Customer, type Lead, type LeadStatus } from '@opsmind/database';
import {
  QUALIFICATION_THRESHOLD,
  scoreLead,
  pickRoundRobinAssignee,
  type LeadScoringInput,
  type ServiceOfferingIcp,
} from '@opsmind/shared-types';
import { EXPLORIUM_GATEWAY, type ExploriumGateway } from '@opsmind/integrations';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DealsService } from '../deals/deals.service';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';

export interface ListLeadsFilter {
  status?: ListLeadsQueryDto['status'];
  sourceType?: ListLeadsQueryDto['sourceType'];
  minScore?: number;
  city?: string;
  state?: string;
  hasWebsite?: boolean;
  hasContactMethod?: boolean;
  search?: string;
}

// Mesmo racional de `PRE_OUTREACH_DRAFTED_STATUSES` em `outreach.service.ts`:
// só nesses status `score()` (e, por consequência, `enrich()`, que termina
// chamando `score()`) tem permissão de ESCREVER `Lead.status` — nunca regride
// um lead que já avançou no pipeline (OUTREACH_DRAFTED em diante, incluindo
// CONTACTED/REPLIED/CONVERTED/LOST) de volta para QUALIFIED/DISQUALIFIED só
// porque alguém pediu um re-score/re-enrich. Sem essa guarda, um lead
// CONVERTED (convertedCustomerId já setado) reescorado voltaria a
// `status: 'QUALIFIED'`, uma linha inconsistente (convertido, mas "não
// convertido" pelo status). `score`/`scoreBreakdown`/`suggestedOfferingId`
// continuam sendo atualizados sempre — são metadados de pontuação, não
// estado de ciclo de vida, então recalculá-los não tem o mesmo risco.
const PRE_QUALIFICATION_STATUSES: LeadStatus[] = ['DISCOVERED', 'QUALIFIED', 'DISQUALIFIED'];

// Tipo do enrichment gravado por `enrich()` — mesmo formato usado por
// `apps/worker/src/lead-scrape-processor.ts` (`type: 'explorium_firmographics'`,
// `data` = `ExploriumBusinessResult` bruto) para que `getFirmographics` leia
// o enrichment mais recente independentemente de ter sido gravado pelo
// worker (scrape em lote) ou por este service (enrich sob demanda).
interface ExploriumFirmographicsData {
  industry?: string | null;
  employeeCount?: number | null;
  revenueUsd?: number | null;
}

function toOfferingIcp(o: {
  id: string;
  signals: string[];
  targetIndustries: string[];
  minEmployees: number | null;
  maxEmployees: number | null;
  minRevenueUsd: number | null;
  maxRevenueUsd: number | null;
}): ServiceOfferingIcp {
  return {
    id: o.id,
    signals: o.signals,
    targetIndustries: o.targetIndustries,
    minEmployees: o.minEmployees,
    maxEmployees: o.maxEmployees,
    minRevenueUsd: o.minRevenueUsd,
    maxRevenueUsd: o.maxRevenueUsd,
  };
}

/**
 * Sem repository layer — chama `PrismaService` diretamente, mesmo padrão de
 * `CustomersService`.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(EXPLORIUM_GATEWAY) private readonly exploriumGateway: ExploriumGateway,
    private readonly dealsService: DealsService,
  ) {}

  async create(organizationId: string, dto: CreateLeadDto, actorUserId: string): Promise<Lead> {
    const lead = await this.prisma.lead.create({
      data: {
        organizationId,
        sourceType: 'MANUAL',
        actorType: 'USER',
        actorId: actorUserId,
        ...dto,
        // `socialLinks` chega tipado como `SocialLinkDto[]` (DTO) — precisa do
        // mesmo cast pra `Prisma.InputJsonValue` que `scoreBreakdown` usa em
        // `score()` abaixo antes de virar JSON no Prisma. `undefined` quando
        // ausente é tratado pelo Prisma como "campo não informado", igual aos
        // demais campos opcionais espalhados por `...dto` acima.
        socialLinks: dto.socialLinks
          ? (dto.socialLinks as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.created',
      resource: `Lead:${lead.id}`,
    });

    return this.autoAssign(organizationId, lead.id, lead);
  }

  /**
   * Round-robin por carga (`pickRoundRobinAssignee`, packages/shared-types)
   * — sem isso, todo lead novo ficava solto até alguém pegar na mão. Chamado
   * sempre na criação (`create()` acima); nunca reatribui um lead que já
   * tem dono (essa é a decisão de `assign()`, sempre manual/explícita).
   * Devolve o próprio lead sem alterar nada quando a organização não tem
   * nenhum membro elegível (nunca lança erro por isso).
   */
  async autoAssign(organizationId: string, leadId: string, currentLead?: Lead): Promise<Lead> {
    const lead = currentLead ?? (await this.findByIdOrThrow(organizationId, leadId));

    const members = await this.prisma.membership.findMany({
      where: { organizationId, role: { in: [...WRITE_ROLES] } },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    if (members.length === 0) {
      return lead;
    }

    const openCounts = await this.prisma.lead.groupBy({
      by: ['assignedUserId'],
      where: {
        organizationId,
        assignedUserId: { in: members.map((m) => m.userId) },
        status: { notIn: ['CONVERTED', 'LOST'] },
      },
      _count: { _all: true },
    });
    const countByUser = new Map(
      (openCounts as Array<{ assignedUserId: string | null; _count: { _all: number } }>).map((row) => [
        row.assignedUserId,
        row._count._all,
      ]),
    );

    const assigneeId = pickRoundRobinAssignee(
      members.map((m) => ({ userId: m.userId, openLeadCount: countByUser.get(m.userId) ?? 0 })),
    );
    if (!assigneeId) {
      return lead;
    }

    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: { assignedUserId: assigneeId },
    });

    await this.auditService.log({
      actorType: 'SYSTEM',
      actorId: null,
      organizationId,
      action: 'lead.auto_assigned',
      resource: `Lead:${leadId}`,
      metadata: { assignedUserId: assigneeId },
    });

    return updated;
  }

  /**
   * Atribuição manual/explícita — sempre vence e nunca é sobrescrita por
   * `autoAssign` depois (que só roda uma vez, na criação). Usada tanto pra
   * reatribuir um lead quanto pra atribuir um lead que nasceu sem nenhum
   * membro elegível na organização.
   */
  async assign(organizationId: string, leadId: string, assigneeUserId: string, actorUserId: string): Promise<Lead> {
    await this.findByIdOrThrow(organizationId, leadId);

    const membership = await this.prisma.membership.findFirst({
      where: { organizationId, userId: assigneeUserId },
    });
    if (!membership) {
      throw new BadRequestException('Usuário não é membro desta organização.');
    }

    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: { assignedUserId: assigneeUserId },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.assigned',
      resource: `Lead:${leadId}`,
      metadata: { assignedUserId: assigneeUserId },
    });

    return updated;
  }

  async findByIdOrThrow(organizationId: string, id: string): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId },
      include: { enrichments: true, outreachMessages: true },
    });
    if (!lead) {
      throw new NotFoundException('Lead não encontrado');
    }
    return lead;
  }

  list(organizationId: string, filter: ListLeadsFilter): Promise<Lead[]> {
    const searchOr = filter.search
      ? [
          { name: { contains: filter.search, mode: 'insensitive' as const } },
          { rawContent: { contains: filter.search, mode: 'insensitive' as const } },
        ]
      : null;
    // `hasContactMethod: true` — pelo menos um canal de contato utilizável.
    // Nota: `socialLinks: []` (array vazio, mas explicitamente não-nulo)
    // passa neste filtro mesmo sem contato real — edge case aceito e
    // documentado (não vale a complexidade de uma query SQL crua só pra
    // cobrir isso, ver Task 4 do plano).
    const contactOr =
      filter.hasContactMethod === true
        ? [
            { phone: { not: null } },
            { email: { not: null } },
            { whatsapp: { not: null } },
            { socialLinks: { not: Prisma.DbNull } },
          ]
        : null;
    // `hasContactMethod: false` — NENHUM canal de contato: complemento exato
    // do `OR` acima, ou seja um `AND` de nulos. Tratado explicitamente por
    // valor (não por truthiness) pela mesma razão de `hasWebsite` mais
    // abaixo: com `filter.hasContactMethod ? ... : null`, `false` caía no
    // mesmo ramo de `undefined` e a opção "Sem contato" da UI devolvia TODOS
    // os leads parecendo filtrada.
    const noContactFilter =
      filter.hasContactMethod === false
        ? {
            phone: null,
            email: null,
            whatsapp: null,
            socialLinks: { equals: Prisma.DbNull },
          }
        : {};
    // `searchOr`/`contactOr` são dois grupos `OR` independentes — combinados
    // num `AND` só quando ambos presentes, pra não colidir a mesma chave
    // `OR` do objeto `where` (a segunda sobrescreveria silenciosamente a
    // primeira). Quando só um dos dois está presente, mantém a forma
    // original (chave `OR` de topo), sem introduzir `AND` à toa.
    const orCombination =
      searchOr && contactOr
        ? { AND: [{ OR: searchOr }, { OR: contactOr }] }
        : searchOr
          ? { OR: searchOr }
          : contactOr
            ? { OR: contactOr }
            : {};

    return this.prisma.lead.findMany({
      where: {
        organizationId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.sourceType ? { sourceType: filter.sourceType } : {}),
        ...(filter.minScore !== undefined ? { score: { gte: filter.minScore } } : {}),
        ...(filter.city ? { city: { equals: filter.city, mode: 'insensitive' as const } } : {}),
        ...(filter.state ? { state: { equals: filter.state, mode: 'insensitive' as const } } : {}),
        ...(filter.hasWebsite === true ? { website: { not: null } } : {}),
        ...(filter.hasWebsite === false ? { website: null } : {}),
        ...noContactFilter,
        ...orCombination,
      },
      orderBy: { discoveredAt: 'desc' },
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateLeadDto,
    actorUserId: string,
  ): Promise<Lead> {
    const lead = await this.findByIdOrThrow(organizationId, id);
    this.assertValidStatusUpdate(lead, dto);

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        ...dto,
        // Mesmo racional do cast em `create()` acima.
        socialLinks: dto.socialLinks
          ? (dto.socialLinks as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.updated',
      resource: `Lead:${id}`,
      // `socialLinks?: SocialLinkDto[]` deixou de ser estruturalmente
      // assinalável a `Prisma.InputJsonValue` (mesmo motivo do cast em
      // `create()`/`update()` acima) — cast explícito, igual ao resto do
      // arquivo.
      metadata: { ...dto } as unknown as Prisma.InputJsonValue,
    });

    return updated;
  }

  /**
   * Guarda de transição para `update()` (`PATCH .../leads/:id`, o endpoint
   * genérico de edição manual — não confundir com `score()`/`enrich()`, que
   * têm sua própria guarda via `PRE_QUALIFICATION_STATUSES` acima).
   *
   * Escopo deliberadamente estreito: fechamos só os dois buracos concretos
   * encontrados (em vez de modelar o grafo de transição completo dos 9
   * `LeadStatus`, o que exigiria decidir regra pra cada par status→status
   * sem um requisito concreto pedindo isso):
   *   1. `status: 'CONVERTED'` nunca é aceito aqui — essa transição só pode
   *      acontecer via `convertToCustomer()`, que cria o `Customer` e seta
   *      `convertedCustomerId` atomicamente com o status. Aceitar aqui
   *      permitiria `status: 'CONVERTED'` com `convertedCustomerId: null`,
   *      uma linha que nenhum outro caminho de código pode produzir.
   *   2. Uma vez `convertedCustomerId` setado (lead já convertido), `status`
   *      não pode mais mudar por este caminho — nem para `CONVERTED`
   *      de novo (redundante, já é), nem para qualquer status anterior
   *      (reverteria uma promoção a cliente já efetivada, sem desfazer o
   *      `Customer` criado).
   * Qualquer outra transição (ex.: QUALIFIED → LOST, DISCOVERED → QUALIFIED
   * manual) continua livre — são transições legítimas de edição manual que
   * o brief não pediu para restringir.
   *
   * 400 (não 409) pelo mesmo motivo de `OutreachService.applyTransition`:
   * do ponto de vista de quem chamou, isto é "essa transição não é válida
   * agora", o mesmo sinal que aquele método usa para toda transição de
   * estado ilegal — não é um conflito de escrita concorrente (esse caso já
   * tem seu próprio 409, o fast-path/race de `convertToCustomer()`).
   */
  private assertValidStatusUpdate(lead: Lead, dto: UpdateLeadDto): void {
    if (dto.status === undefined) {
      return;
    }
    if (dto.status === 'CONVERTED') {
      throw new BadRequestException(
        'Use o endpoint /convert para marcar um lead como convertido',
      );
    }
    if (lead.convertedCustomerId && dto.status !== lead.status) {
      throw new BadRequestException(
        'Lead já convertido em cliente — status não pode mais ser alterado por aqui',
      );
    }
  }

  /**
   * `POST .../leads/:leadId/score` — recalcula `score`/`scoreBreakdown`/
   * `status` via `scoreLead()` (função pura, `@opsmind/shared-types`), a
   * MESMA usada por `apps/worker/src/lead-scrape-processor.ts` no scraping em
   * lote — nunca diverge entre os dois caminhos. Só as `ServiceOffering`
   * ativas entram no cálculo, mesmo filtro do worker. Firmographics vêm do
   * `LeadEnrichment` mais recente do tipo `explorium_firmographics`, se
   * existir (ver `getFirmographics`).
   */
  async score(organizationId: string, id: string, actorUserId: string): Promise<Lead> {
    const lead = await this.findByIdOrThrow(organizationId, id);

    const offerings = await this.prisma.serviceOffering.findMany({
      where: { organizationId, isActive: true },
    });
    const firmographics = await this.getFirmographics(organizationId, id);

    const scoreInput: LeadScoringInput = {
      website: lead.website,
      googleCategory: lead.googleCategory,
      rating: lead.rating ? Number(lead.rating) : null,
      reviewCount: lead.reviewCount,
      rawContent: lead.rawContent,
      firmographics,
    };
    const breakdown = scoreLead(scoreInput, offerings.map(toOfferingIcp));
    const computedStatus: LeadStatus = breakdown.total >= QUALIFICATION_THRESHOLD ? 'QUALIFIED' : 'DISQUALIFIED';
    // Ver comentário de `PRE_QUALIFICATION_STATUSES` no topo do arquivo.
    const canUpdateStatus = PRE_QUALIFICATION_STATUSES.includes(lead.status);

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        score: breakdown.total,
        scoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
        ...(canUpdateStatus ? { status: computedStatus } : {}),
        suggestedOfferingId: breakdown.matchedOfferingId,
      },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.scored',
      resource: `Lead:${id}`,
      metadata: { score: breakdown.total, status: canUpdateStatus ? computedStatus : lead.status },
    });

    return updated;
  }

  /**
   * `POST .../leads/:leadId/enrich` — enrichment sob demanda de UM lead
   * (fora do fluxo de scrape em massa, que já enriquece via
   * `NEEDS_MATCH_ENRICHMENT` no worker): chama `ExploriumGateway.matchBusiness`
   * diretamente, grava o resultado como `LeadEnrichment` (mesmo `type` que o
   * worker usa, `explorium_firmographics`, para que `score()` leia os dois
   * casos sem distinção) e recalcula o score em seguida.
   */
  async enrich(organizationId: string, id: string, actorUserId: string): Promise<Lead> {
    const lead = await this.findByIdOrThrow(organizationId, id);

    const match = await this.exploriumGateway.matchBusiness(lead.name, lead.address, lead.website);
    if (match) {
      await this.prisma.leadEnrichment.create({
        data: {
          organizationId,
          leadId: id,
          type: 'explorium_firmographics',
          data: match as unknown as Prisma.InputJsonValue,
          actorType: 'USER',
          actorId: actorUserId,
        },
      });
    }

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.enriched',
      resource: `Lead:${id}`,
      metadata: { matched: match !== null },
    });

    return this.score(organizationId, id, actorUserId);
  }

  /**
   * `POST .../leads/:leadId/convert` — promove o Lead a `Customer`.
   * Cria o `Customer` PRIMEIRO; se a guarda de corrida abaixo (`updateMany`
   * condicional no WHERE, mesmo padrão de `OutreachService.applyTransition`)
   * perder uma conversão concorrente do mesmo lead e lançar, a transação de
   * request inteira (aberta pelo `TenantContextInterceptor` global) é
   * revertida pelo Nest/Prisma — este `create()` nunca fica "pendurado" sem
   * o `Lead` correspondente ter sido de fato marcado `CONVERTED`.
   */
  async convertToCustomer(
    organizationId: string,
    leadId: string,
    dto: ConvertLeadDto,
    actorUserId: string,
  ): Promise<Customer> {
    const lead = await this.findByIdOrThrow(organizationId, leadId);
    if (lead.convertedCustomerId) {
      throw new ConflictException('Lead já foi convertido em cliente');
    }

    const customer = await this.prisma.customer.create({
      data: {
        organizationId,
        name: dto.name ?? lead.name,
        company: dto.company ?? lead.name,
        phone: lead.phone,
        email: lead.email,
        status: 'LEAD',
      },
    });

    const { count } = await this.prisma.lead.updateMany({
      where: { id: leadId, organizationId, convertedCustomerId: null },
      data: { status: 'CONVERTED', convertedCustomerId: customer.id },
    });
    if (count === 0) {
      throw new ConflictException('Lead já foi convertido em cliente');
    }

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'lead.converted',
      resource: `Lead:${leadId}`,
      metadata: { customerId: customer.id },
    });

    // Ponte "achar -> fechar" (plano pensando-como-empresa-com-agile-beaver.md):
    // sem isso, todo Lead convertido exigiria um passo manual extra (criar o
    // Deal) fácil de esquecer, esvaziando o propósito do pipeline de
    // negociação. `value: 0` — não força o vendedor a adivinhar um número no
    // momento da conversão, só garante que o Deal existe e aparece no
    // Kanban para ser preenchido depois.
    await this.dealsService.create(
      organizationId,
      { customerId: customer.id, title: lead.name, value: 0 },
      actorUserId,
      { originLeadId: leadId },
    );

    return customer;
  }

  private async getFirmographics(
    organizationId: string,
    leadId: string,
  ): Promise<LeadScoringInput['firmographics']> {
    const enrichment = await this.prisma.leadEnrichment.findFirst({
      where: { organizationId, leadId, type: 'explorium_firmographics' },
      orderBy: { createdAt: 'desc' },
    });
    if (!enrichment) {
      return null;
    }
    const data = enrichment.data as unknown as ExploriumFirmographicsData;
    return {
      industry: data.industry ?? null,
      employeeCount: data.employeeCount ?? null,
      revenueUsd: data.revenueUsd ?? null,
    };
  }
}
