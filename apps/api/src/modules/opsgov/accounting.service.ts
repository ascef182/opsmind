import { Injectable, NotFoundException } from '@nestjs/common';
import type { AccountingDecision, AccountingProposal, Prisma } from '@opsmind/database';
import { DEFAULT_ACCOUNTING_DECISIONS } from '@opsmind/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertDocumentOfOrganization } from './assert-document';
import type {
  AddAnswerDto,
  CreateDecisionDto,
  CreateProposalDto,
  DecideDto,
  DecisionStatusDto,
  UpdateProposalDto,
} from './dto/accounting.dto';
import type { OpsGovActor } from './opsgov.types';

type Tx = Prisma.TransactionClient;

export interface DecisionAnswer {
  text: string;
  author: string;
  authorUserId: string | null;
  at: string;
}

export interface ProposalView {
  id: string;
  firm: string;
  contactName: string | null;
  scenario: AccountingProposal['scenario'];
  setupCents: number;
  monthlyFeeCents: number;
  annualCents: number;
  includes: string[];
  notes: string | null;
  documentId: string | null;
  createdAt: string;
}

export interface DecisionView {
  id: string;
  seedKey: string | null;
  topic: string;
  question: string;
  answers: DecisionAnswer[];
  finalDecision: string | null;
  decidedAt: string | null;
  status: AccountingDecision['status'];
  updatedAt: string;
}

const cleanIncludes = (items: string[] | undefined) =>
  (items ?? []).map((item) => item.trim()).filter((item, i, all) => item.length > 0 && all.indexOf(item) === i);

/**
 * Espaço do contador: propostas de escritórios e as decisões da passagem
 * MEI → ME. Respostas são append-only; reabrir ou trocar uma decisão final
 * registra a anterior como resposta antes, para o histórico nunca sumir.
 */
@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listProposals(organizationId: string): Promise<ProposalView[]> {
    const rows = await this.prisma.accountingProposal.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toProposalView);
  }

  async createProposal(organizationId: string, dto: CreateProposalDto, actor: OpsGovActor): Promise<ProposalView> {
    await assertDocumentOfOrganization(this.prisma, organizationId, dto.documentId);
    const row = await this.prisma.accountingProposal.create({
      data: {
        organizationId,
        firm: dto.firm.trim(),
        contactName: dto.contactName?.trim() || null,
        scenario: dto.scenario,
        setupCents: dto.setupCents,
        monthlyFeeCents: dto.monthlyFeeCents,
        annualCents: dto.annualCents ?? 0,
        includes: cleanIncludes(dto.includes),
        notes: dto.notes ?? null,
        documentId: dto.documentId ?? null,
        actorType: actor.type,
        actorId: actor.id,
      },
    });
    await this.audit(organizationId, actor, 'opsgov.accounting_proposal.created', `AccountingProposal:${row.id}`, {
      firm: row.firm,
      scenario: row.scenario,
    });
    return toProposalView(row);
  }

  async updateProposal(organizationId: string, id: string, dto: UpdateProposalDto, actor: OpsGovActor): Promise<ProposalView> {
    const current = await this.prisma.accountingProposal.findFirst({ where: { id, organizationId } });
    if (!current) throw new NotFoundException('Proposta não encontrada');
    await assertDocumentOfOrganization(this.prisma, organizationId, dto.documentId);
    const row = await this.prisma.accountingProposal.update({
      where: { id: current.id },
      data: {
        ...(dto.firm !== undefined ? { firm: dto.firm.trim() } : {}),
        ...(dto.contactName !== undefined ? { contactName: dto.contactName.trim() || null } : {}),
        ...(dto.scenario !== undefined ? { scenario: dto.scenario } : {}),
        ...(dto.setupCents !== undefined ? { setupCents: dto.setupCents } : {}),
        ...(dto.monthlyFeeCents !== undefined ? { monthlyFeeCents: dto.monthlyFeeCents } : {}),
        ...(dto.annualCents !== undefined ? { annualCents: dto.annualCents } : {}),
        ...(dto.includes !== undefined ? { includes: cleanIncludes(dto.includes) } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.documentId !== undefined ? { documentId: dto.documentId } : {}),
      },
    });
    await this.audit(organizationId, actor, 'opsgov.accounting_proposal.updated', `AccountingProposal:${row.id}`, {
      before: { setupCents: current.setupCents, monthlyFeeCents: current.monthlyFeeCents, annualCents: current.annualCents },
    });
    return toProposalView(row);
  }

  async deleteProposal(organizationId: string, id: string, actor: OpsGovActor): Promise<void> {
    const current = await this.prisma.accountingProposal.findFirst({ where: { id, organizationId } });
    if (!current) throw new NotFoundException('Proposta não encontrada');
    await this.prisma.accountingProposal.delete({ where: { id: current.id } });
    // O registro completo vai para a auditoria: apagar a proposta não apaga o que ela dizia.
    await this.audit(organizationId, actor, 'opsgov.accounting_proposal.deleted', `AccountingProposal:${current.id}`, {
      proposal: toProposalView(current) as unknown as Record<string, unknown>,
    });
  }

  async listDecisions(organizationId: string): Promise<DecisionView[]> {
    const rows = await this.prisma.accountingDecision.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'asc' }, { topic: 'asc' }],
    });
    // Padrão primeiro, na ordem em que a lista foi pensada (do CNPJ ao endereço); depois as criadas à mão.
    const position = (row: AccountingDecision) => {
      const index = DEFAULT_ACCOUNTING_DECISIONS.findIndex((d) => d.key === row.seedKey);
      return index === -1 ? DEFAULT_ACCOUNTING_DECISIONS.length : index;
    };
    return rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => position(a.row) - position(b.row) || a.i - b.i)
      .map(({ row }) => toDecisionView(row));
  }

  /** Carrega as decisões padrão que ainda não existem (idempotente). */
  async loadDefaultDecisions(organizationId: string, actor: OpsGovActor): Promise<{ created: number }> {
    const result = await this.prisma.accountingDecision.createMany({
      data: DEFAULT_ACCOUNTING_DECISIONS.map((d) => ({
        organizationId,
        seedKey: d.key,
        topic: d.topic,
        question: d.question,
        actorType: actor.type,
        actorId: actor.id,
      })),
      skipDuplicates: true,
    });
    if (result.count > 0) {
      await this.audit(organizationId, actor, 'opsgov.accounting_decision.defaults_loaded', 'AccountingDecision:batch', {
        created: result.count,
      });
    }
    return { created: result.count };
  }

  async createDecision(organizationId: string, dto: CreateDecisionDto, actor: OpsGovActor): Promise<DecisionView> {
    const row = await this.prisma.accountingDecision.create({
      data: { organizationId, topic: dto.topic.trim(), question: dto.question.trim(), actorType: actor.type, actorId: actor.id },
    });
    await this.audit(organizationId, actor, 'opsgov.accounting_decision.created', `AccountingDecision:${row.id}`, { topic: row.topic });
    return toDecisionView(row);
  }

  async addAnswer(organizationId: string, id: string, dto: AddAnswerDto, actor: OpsGovActor): Promise<DecisionView> {
    const author = dto.author?.trim() || (await this.actorName(actor));
    const row = await this.withLockedDecision(organizationId, id, (tx, current) =>
      tx.accountingDecision.update({
        where: { id: current.id },
        data: {
          answers: [...answersOf(current), answer(dto.text.trim(), author, actor)] as unknown as Prisma.InputJsonValue,
          // Primeira resposta tira a pergunta da fila de pendentes.
          ...(current.status === 'PENDENTE' ? { status: 'EM_ANALISE' as const } : {}),
        },
      }),
    );
    await this.audit(organizationId, actor, 'opsgov.accounting_decision.answered', `AccountingDecision:${row.id}`, {});
    return toDecisionView(row);
  }

  async decide(organizationId: string, id: string, dto: DecideDto, actor: OpsGovActor): Promise<DecisionView> {
    const name = await this.actorName(actor);
    const row = await this.withLockedDecision(organizationId, id, (tx, current) => {
      const history = answersOf(current);
      if (current.finalDecision) history.push(answer(`Decisão anterior: ${current.finalDecision}`, name, actor));
      return tx.accountingDecision.update({
        where: { id: current.id },
        data: {
          answers: history as unknown as Prisma.InputJsonValue,
          finalDecision: dto.finalDecision.trim(),
          decidedAt: new Date(),
          status: 'DECIDIDO',
        },
      });
    });
    await this.audit(organizationId, actor, 'opsgov.accounting_decision.decided', `AccountingDecision:${row.id}`, {
      finalDecision: row.finalDecision,
    });
    return toDecisionView(row);
  }

  async setStatus(organizationId: string, id: string, dto: DecisionStatusDto, actor: OpsGovActor): Promise<DecisionView> {
    const name = await this.actorName(actor);
    const row = await this.withLockedDecision(organizationId, id, (tx, current) => {
      const history = answersOf(current);
      if (current.finalDecision) history.push(answer(`Decisão reaberta. Decisão anterior: ${current.finalDecision}`, name, actor));
      return tx.accountingDecision.update({
        where: { id: current.id },
        data: { answers: history as unknown as Prisma.InputJsonValue, status: dto.status, finalDecision: null, decidedAt: null },
      });
    });
    await this.audit(organizationId, actor, 'opsgov.accounting_decision.status_changed', `AccountingDecision:${row.id}`, {
      status: dto.status,
    });
    return toDecisionView(row);
  }

  // Serializa escritas na mesma decisão: duas respostas simultâneas não se sobrescrevem.
  private withLockedDecision(
    organizationId: string,
    id: string,
    fn: (tx: Tx, current: AccountingDecision) => Promise<AccountingDecision>,
  ): Promise<AccountingDecision> {
    return this.prisma.runInTransaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM accounting_decisions WHERE id = ${id} FOR UPDATE`;
      const current = await tx.accountingDecision.findFirst({ where: { id, organizationId } });
      if (!current) throw new NotFoundException('Decisão não encontrada');
      return fn(tx, current);
    });
  }

  private async actorName(actor: OpsGovActor): Promise<string> {
    if (actor.type !== 'USER') return actor.type;
    const user = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } });
    return user?.name ?? user?.email ?? 'Usuário';
  }

  private audit(organizationId: string, actor: OpsGovActor, action: string, resource: string, metadata: Record<string, unknown>) {
    return this.auditService.log({
      actorType: actor.type,
      actorId: actor.id,
      organizationId,
      action,
      resource,
      metadata: metadata as Prisma.InputJsonValue,
    });
  }
}

function answer(text: string, author: string, actor: OpsGovActor): DecisionAnswer {
  return { text, author, authorUserId: actor.type === 'USER' ? actor.id : null, at: new Date().toISOString() };
}

function answersOf(row: AccountingDecision): DecisionAnswer[] {
  return Array.isArray(row.answers) ? [...(row.answers as unknown as DecisionAnswer[])] : [];
}

function toProposalView(row: AccountingProposal): ProposalView {
  return {
    id: row.id,
    firm: row.firm,
    contactName: row.contactName,
    scenario: row.scenario,
    setupCents: row.setupCents,
    monthlyFeeCents: row.monthlyFeeCents,
    annualCents: row.annualCents,
    includes: row.includes,
    notes: row.notes,
    documentId: row.documentId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDecisionView(row: AccountingDecision): DecisionView {
  return {
    id: row.id,
    seedKey: row.seedKey,
    topic: row.topic,
    question: row.question,
    answers: answersOf(row),
    finalDecision: row.finalDecision,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}
