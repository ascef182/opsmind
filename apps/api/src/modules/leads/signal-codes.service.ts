import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SignalCode } from '@opsmind/database';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Governança do vocabulário de `SignalCode` (ver
 * docs/planning/2026-11-06-harvey-inteligencia-comercial.md §4). Existência
 * já é garantida pela FK real `lead_signals.signal_code -> signal_codes.code`
 * (sem precisar de trigger) — este serviço cobre a parte que uma FK não
 * cobre: o ciclo de vida PROPOSED -> CONFIRMED/DEPRECATED, e nunca deixar
 * uma organização propor/confirmar um código GLOBAL (`organizationId: null`)
 * por engano.
 */
@Injectable()
export class SignalCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Códigos visíveis para esta organização: globais (RLS já filtra) + os propostos por ela mesma. */
  list(organizationId: string): Promise<SignalCode[]> {
    return this.prisma.signalCode.findMany({
      where: { OR: [{ organizationId: null }, { organizationId }] },
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    });
  }

  /**
   * Propõe um código NOVO, sempre `PROPOSED`, sempre escopado a esta
   * organização — nunca global, nunca já `CONFIRMED` (ver regra dura
   * equivalente em `propose_signal_code.tool.ts`, Fase 5).
   */
  async propose(
    organizationId: string,
    dto: { code: string; label: string; category: string },
    actorUserId: string,
  ): Promise<SignalCode> {
    const existing = await this.prisma.signalCode.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new BadRequestException(`O código "${dto.code}" já existe (status: ${existing.status}).`);
    }

    const created = await this.prisma.signalCode.create({
      data: { code: dto.code, organizationId, label: dto.label, category: dto.category, status: 'PROPOSED' },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'signal_code.propose',
      resource: `SignalCode:${created.code}`,
    });

    return created;
  }

  /** Promove PROPOSED -> CONFIRMED. Só um admin humano, nunca uma tool de IA. */
  async confirm(organizationId: string, code: string, actorUserId: string): Promise<SignalCode> {
    const signalCode = await this.prisma.signalCode.findFirst({
      where: { code, organizationId },
    });
    if (!signalCode) {
      throw new NotFoundException(`Código "${code}" não encontrado para esta organização.`);
    }
    if (signalCode.status !== 'PROPOSED') {
      throw new BadRequestException(`Código "${code}" não está em PROPOSED (está em ${signalCode.status}).`);
    }

    const updated = await this.prisma.signalCode.update({
      where: { code },
      data: { status: 'CONFIRMED' },
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: actorUserId,
      organizationId,
      action: 'signal_code.confirm',
      resource: `SignalCode:${code}`,
    });

    return updated;
  }
}
