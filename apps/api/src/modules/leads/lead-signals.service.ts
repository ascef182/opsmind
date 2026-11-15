import { Injectable, NotFoundException } from '@nestjs/common';
import type { LeadSignal } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WebsiteProfileQueueService } from '../../infrastructure/queue/website-profile-queue.service';
import { LeadsService } from './leads.service';

export interface SignalEvidence {
  signalCode: string;
  label: string;
  confidence: string;
  evidenceUrl: string | null;
  evidenceQuote: string | null;
}

export interface SignalOfferingMapping {
  offeringId: string;
  matchedSignalCodes: string[];
  evidence: SignalEvidence[];
}

/**
 * Leitura de `LeadSignal` (nunca escrita — quem grava é
 * `apps/worker/src/website-profiler-processor.ts`, dentro de
 * `withTenantContext`, não este serviço) + disparo manual do profiler via
 * `WebsiteProfileQueueService`. Ver
 * docs/planning/2026-11-06-harvey-inteligencia-comercial.md §5.
 */
@Injectable()
export class LeadSignalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsService: LeadsService,
    private readonly websiteProfileQueueService: WebsiteProfileQueueService,
  ) {}

  async listForLead(organizationId: string, leadId: string): Promise<LeadSignal[]> {
    // Garante 404 (não vazamento cross-tenant via lista vazia) quando o
    // lead não existe nesta organização, mesmo padrão de outros métodos
    // deste módulo.
    await this.leadsService.findByIdOrThrow(organizationId, leadId);

    return this.prisma.leadSignal.findMany({
      where: { organizationId, leadId },
      orderBy: { observedAt: 'desc' },
    });
  }

  /**
   * Enfileira uma investigação de site (Fase 1 — sem IA, gatilho manual via
   * `POST .../leads/:leadId/investigate`; a tool de IA
   * `investigate_company_website`, Fase 3, chama este mesmo método).
   */
  async requestInvestigation(organizationId: string, leadId: string, actorUserId: string): Promise<void> {
    const lead = await this.leadsService.findByIdOrThrow(organizationId, leadId);
    if (!lead.website) {
      throw new NotFoundException('Este lead não tem um site conhecido para investigar.');
    }

    await this.websiteProfileQueueService.enqueue({
      organizationId,
      leadId,
      actorType: 'USER',
      actorId: actorUserId,
    });
  }

  /**
   * Agrupa os sinais CONFIRMADOS (nunca `AI_ANALYSIS` — mesma exclusão de
   * `LeadsService.getConfirmedSignalsForScoring`) deste lead por oferta
   * sugerida, sempre com a evidência de cada sinal junto — nunca uma
   * conclusão isolada ("este lead precisa de X") sem o porquê. Determinístico,
   * sem chamada de IA: usado pela tool `map_signal_to_offering` e por
   * qualquer UI que queira mostrar "por que esta oferta foi sugerida".
   */
  async mapToOfferings(organizationId: string, leadId: string): Promise<SignalOfferingMapping[]> {
    await this.leadsService.findByIdOrThrow(organizationId, leadId);

    const rows = await this.prisma.leadSignal.findMany({
      where: { organizationId, leadId, collector: { in: ['WEBSITE_PROFILER', 'MANUAL'] } },
      orderBy: { observedAt: 'desc' },
      include: { signalCodeRef: { select: { status: true, label: true, defaultServiceOfferingId: true } } },
    });

    const latestByCode = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latestByCode.has(row.signalCode)) {
        latestByCode.set(row.signalCode, row);
      }
    }

    const byOffering = new Map<string, SignalOfferingMapping>();
    for (const row of latestByCode.values()) {
      const offeringId = row.signalCodeRef.defaultServiceOfferingId;
      if (row.signalCodeRef.status !== 'CONFIRMED' || !offeringId) {
        continue;
      }
      const evidence: SignalEvidence = {
        signalCode: row.signalCode,
        label: row.signalCodeRef.label,
        confidence: row.confidence.toString(),
        evidenceUrl: row.evidenceUrl,
        evidenceQuote: row.evidenceQuote,
      };
      const existing = byOffering.get(offeringId);
      if (existing) {
        existing.matchedSignalCodes.push(row.signalCode);
        existing.evidence.push(evidence);
      } else {
        byOffering.set(offeringId, { offeringId, matchedSignalCodes: [row.signalCode], evidence: [evidence] });
      }
    }

    return Array.from(byOffering.values());
  }
}
