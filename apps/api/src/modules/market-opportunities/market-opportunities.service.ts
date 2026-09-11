import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MarketOpportunity, MarketOpportunityStatus } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';

// Repetida aqui (não só na `@IsIn` de `UpdateMarketOpportunityStatusDto`)
// porque `updateStatus` é chamado por um controller HTTP hoje, mas o
// service não deve depender só da validação de borda do DTO para recusar um
// valor fora do enum — mesma disciplina de "o service não confia
// cegamente no chamador" do resto do módulo.
const MARKET_OPPORTUNITY_STATUSES: MarketOpportunityStatus[] = [
  'NEW',
  'REVIEWING',
  'PURSUING',
  'DISMISSED',
];

/**
 * `MarketOpportunity` é sempre GERADA por `RedditClusteringConsumer`
 * (clustering de IA, automático) — este service NUNCA cria nem apaga uma
 * linha, só lê e muda `status`. `status` é o único campo que um humano
 * controla diretamente: o consumer de clustering (`reddit-clustering.
 * consumer.ts`) tem permissão para atualizar `mentionCount`/`sourceUrls`/
 * `sampleQuotes` num upsert, mas NUNCA `status` — essa linha é sempre
 * escrita por `updateStatus`, chamado só pelo endpoint HTTP humano
 * (`PATCH .../market-opportunities/:id/status`, `WRITE_ROLES`-gated). Um
 * scan automático que reprocessasse o mesmo tópico não pode reverter uma
 * decisão humana (ex.: voltar um `DISMISSED` para `NEW`).
 */
@Injectable()
export class MarketOpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findByIdOrThrow(organizationId: string, id: string): Promise<MarketOpportunity> {
    const opportunity = await this.prisma.marketOpportunity.findFirst({
      where: { id, organizationId },
    });
    if (!opportunity) {
      throw new NotFoundException('Oportunidade de mercado não encontrada');
    }
    return opportunity;
  }

  list(organizationId: string, status?: MarketOpportunityStatus): Promise<MarketOpportunity[]> {
    return this.prisma.marketOpportunity.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { discoveredAt: 'desc' },
    });
  }

  async updateStatus(
    organizationId: string,
    id: string,
    status: MarketOpportunityStatus,
    userId: string,
  ): Promise<MarketOpportunity> {
    if (!MARKET_OPPORTUNITY_STATUSES.includes(status)) {
      throw new BadRequestException('Status de oportunidade de mercado inválido');
    }

    await this.findByIdOrThrow(organizationId, id);

    const updated = await this.prisma.marketOpportunity.update({
      where: { id },
      data: { status },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: userId,
      organizationId,
      action: 'market_opportunity.status_updated',
      resource: `MarketOpportunity:${id}`,
      metadata: { status },
    });

    return updated;
  }
}
