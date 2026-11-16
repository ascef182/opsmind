import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
    // `code` é PK global no Postgres, mas RLS esconde da organização atual
    // uma linha já existente de outra organização (ou global) — um
    // `findUnique` prévio devolveria `null` mesmo quando o código já existe,
    // e um `create()` subsequente estouraria a constraint única real (P2002,
    // 500 bruto, abortando a transação única por-requisição). `createMany` +
    // `skipDuplicates` usa `ON CONFLICT DO NOTHING` por baixo: nunca aborta a
    // transação, e o `count` devolvido (0 ou 1) é a única informação que
    // tratamos — nunca confirmamos nem negamos para quem a colisão pertence.
    const { count } = await this.prisma.signalCode.createMany({
      data: [{ code: dto.code, organizationId, label: dto.label, category: dto.category, status: 'PROPOSED' }],
      skipDuplicates: true,
    });
    if (count === 0) {
      throw new ConflictException(`Não foi possível propor o código "${dto.code}" — tente outro nome.`);
    }

    const created = await this.prisma.signalCode.findUniqueOrThrow({ where: { code: dto.code } });

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
