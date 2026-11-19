'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { accountingCostComparison, parseReaisToCents } from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import {
  useAnswerDecision,
  useCreateDecision,
  useDecide,
  useDecisions,
  useDeleteProposal,
  useLoadDefaultDecisions,
  useProposals,
  useReopenDecision,
  useSaveProposal,
} from '@/lib/opsgov/use-accounting';
import { useRealSimulation } from '@/lib/opsgov/use-simples';
import {
  DECISION_STATUS_LABELS,
  OPSGOV_FINANCE_ROLES,
  OPSGOV_WRITE_ROLES,
  SCENARIO_LABELS,
  type AccountingDecision,
  type AccountingDecisionStatus,
  type AccountingProposal,
  type AccountingScenario,
} from '@/lib/opsgov/types';
import type { UploadedDocument } from '@/lib/documents/files';
import { brl, centsToReaisInput } from '@/lib/finance/format';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/finance/finance-ui';
import { DocumentField, DocumentLink } from '@/components/opsgov/document-field';
import { cn } from '@/lib/utils';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// ── Propostas ──────────────────────────────────────────────────────────────

function ProposalDialog({
  organizationId,
  editing,
  open,
  onClose,
}: {
  organizationId: string;
  editing: AccountingProposal | null;
  open: boolean;
  onClose: () => void;
}) {
  const save = useSaveProposal(organizationId);
  const [firm, setFirm] = useState('');
  const [contactName, setContactName] = useState('');
  const [scenario, setScenario] = useState<AccountingScenario>('A_TRANSFORMAR');
  const [setup, setSetup] = useState('');
  const [monthly, setMonthly] = useState('');
  const [annual, setAnnual] = useState('');
  const [includes, setIncludes] = useState('');
  const [notes, setNotes] = useState('');
  const [proof, setProof] = useState<UploadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setProof(null);
    setFirm(editing?.firm ?? '');
    setContactName(editing?.contactName ?? '');
    setScenario(editing?.scenario ?? 'A_TRANSFORMAR');
    setSetup(editing ? centsToReaisInput(editing.setupCents) : '');
    setMonthly(editing ? centsToReaisInput(editing.monthlyFeeCents) : '');
    setAnnual(editing ? centsToReaisInput(editing.annualCents) : '');
    setIncludes(editing?.includes.join('\n') ?? '');
    setNotes(editing?.notes ?? '');
  }, [open, editing]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const setupCents = parseReaisToCents(setup || '0');
    const monthlyFeeCents = parseReaisToCents(monthly || '0');
    const annualCents = parseReaisToCents(annual || '0');
    if (!firm.trim()) return setError('Informe o escritório.');
    if (setupCents === null || monthlyFeeCents === null || annualCents === null) return setError('Valores inválidos.');
    save.mutate(
      {
        id: editing?.id,
        firm: firm.trim(),
        contactName: contactName.trim() || undefined,
        scenario,
        setupCents,
        monthlyFeeCents,
        annualCents,
        includes: includes.split('\n').map((l) => l.trim()).filter(Boolean),
        notes: notes.trim() || undefined,
        ...(proof ? { documentId: proof.id } : {}),
      },
      { onSuccess: onClose, onError: (e) => setError(errorText(e, 'Não foi possível salvar a proposta.')) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar proposta' : 'Nova proposta de contador'}</DialogTitle>
          <DialogDescription>Valores como estão na proposta. Os tributos entram no comparativo pelo simulador.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Escritório">
              <Input value={firm} onChange={(e) => setFirm(e.target.value)} />
            </Field>
            <Field label="Contato">
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </Field>
          </div>
          <Field label="Cenário">
            <Select value={scenario} onChange={(e) => setScenario(e.target.value as AccountingScenario)}>
              {(Object.keys(SCENARIO_LABELS) as AccountingScenario[]).map((s) => (
                <option key={s} value={s}>
                  {SCENARIO_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Custo inicial (R$)">
              <Input inputMode="decimal" value={setup} onChange={(e) => setSetup(e.target.value)} />
            </Field>
            <Field label="Mensalidade (R$)">
              <Input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </Field>
            <Field label="Extras anuais (R$)" hint="13ª, DEFIS, IRPF…">
              <Input inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} />
            </Field>
          </div>
          <Field label="O que está incluído (um item por linha)">
            <Textarea rows={4} value={includes} onChange={(e) => setIncludes(e.target.value)} />
          </Field>
          <Field label="Observações">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DocumentField
            organizationId={organizationId}
            value={proof}
            onChange={setProof}
            label={editing?.documentId ? 'Substituir PDF da proposta (opcional)' : 'PDF da proposta (opcional)'}
          />
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProposalsSection({ organizationId }: { organizationId: string }) {
  const proposals = useProposals(organizationId);
  const remove = useDeleteProposal(organizationId);
  const real = useRealSimulation(organizationId, { folhaMensalCents: 0, inssSocioRateBp: 1100 });
  const [dialog, setDialog] = useState<{ editing: AccountingProposal | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [faturamento, setFaturamento] = useState('');
  const [folha, setFolha] = useState('0');
  const [inss, setInss] = useState('11');

  // Ponto de partida do comparativo: a média real dos últimos 12 meses, se houver.
  useEffect(() => {
    if (faturamento) return;
    const avg = real.data?.simulation?.faturamentoMensalCents;
    if (avg) setFaturamento(centsToReaisInput(avg));
    else if (real.isFetched) setFaturamento('10.000,00');
  }, [real.data, real.isFetched, faturamento]);

  const rows = useMemo(() => proposals.data ?? [], [proposals.data]);
  const comparison = useMemo(() => {
    const faturamentoMensalCents = parseReaisToCents(faturamento || '0');
    const folhaMensalCents = parseReaisToCents(folha || '0');
    const inssPct = Number(inss.replace(',', '.'));
    if (faturamentoMensalCents === null || folhaMensalCents === null || !Number.isFinite(inssPct)) return null;
    try {
      return accountingCostComparison(rows, { faturamentoMensalCents, folhaMensalCents, inssSocioRateBp: Math.round(inssPct * 100) });
    } catch {
      return null;
    }
  }, [rows, faturamento, folha, inss]);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h3">Propostas e comparativo</h2>
        <Button size="sm" variant="secondary" onClick={() => setDialog({ editing: null })}>
          Nova proposta
        </Button>
      </div>

      {proposals.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Cadastre as propostas dos escritórios para comparar o custo do 1º ano e dos seguintes.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-3">
            <Field label="Faturamento/mês (R$)" hint={real.data?.simulation ? 'Começa pela média real dos últimos 12 meses' : undefined}>
              <Input inputMode="decimal" value={faturamento} onChange={(e) => setFaturamento(e.target.value)} />
            </Field>
            <Field label="Pró-labore/mês (R$)">
              <Input inputMode="decimal" value={folha} onChange={(e) => setFolha(e.target.value)} />
            </Field>
            <Field label="INSS (%)">
              <Input inputMode="decimal" value={inss} onChange={(e) => setInss(e.target.value)} className="w-20" />
            </Field>
          </div>
          {comparison ? (
            <>
              <p className="text-xs text-muted-foreground">
                Tributos estimados: {brl(comparison.monthlyTaxCents)}/mês (DAS + INSS do sócio,{' '}
                {comparison.taxBasis === 'COM_FATOR_R'
                  ? `com pró-labore mínimo de ${brl(comparison.simulation.proLaboreMinimoCents)} para o Fator R`
                  : `Anexo ${comparison.simulation.atual.anexo}`}
                ). Estimativa, não é parecer contábil.
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Proposta</TableHead>
                      <TableHead className="text-right">Inicial</TableHead>
                      <TableHead className="text-right">Mensal</TableHead>
                      <TableHead className="text-right">Anual extra</TableHead>
                      <TableHead className="text-right">Tributos/ano</TableHead>
                      <TableHead className="text-right">1º ano</TableHead>
                      <TableHead className="text-right">2º ano em diante</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.proposals.map((c) => {
                      const p = rows.find((r) => r.id === c.id)!;
                      return (
                        <TableRow key={c.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span>{p.firm}</span>
                              <span className="text-xs text-muted-foreground">{SCENARIO_LABELS[p.scenario]}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{brl(p.setupCents)}</TableCell>
                          <TableCell className="text-right tabular-nums">{brl(p.monthlyFeeCents)}</TableCell>
                          <TableCell className="text-right tabular-nums">{brl(p.annualCents)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{brl(c.taxesYearCents)}</TableCell>
                          <TableCell className={cn('text-right font-medium tabular-nums', comparison.cheapestFirstYearId === c.id && rows.length > 1 && 'text-positive-500')}>
                            {brl(c.firstYearCents)}
                          </TableCell>
                          <TableCell className={cn('text-right font-medium tabular-nums', comparison.cheapestRecurringId === c.id && rows.length > 1 && 'text-positive-500')}>
                            {brl(c.recurringYearCents)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <FormError message="Preencha valores válidos para comparar." />
          )}

          <ul className="grid gap-3 md:grid-cols-2">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-medium">{p.firm}</span>
                    <span className="text-xs text-muted-foreground">
                      {SCENARIO_LABELS[p.scenario]}
                      {p.contactName && ` · ${p.contactName}`}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ editing: p })}>
                      Editar
                    </Button>
                    {confirmDelete === p.id ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-negative-500"
                        isLoading={remove.isPending}
                        onClick={() => remove.mutate(p.id, { onSettled: () => setConfirmDelete(null) })}
                      >
                        Confirmar exclusão
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(p.id)}>
                        Excluir
                      </Button>
                    )}
                  </div>
                </div>
                {p.includes.length > 0 && (
                  <ul className="flex flex-wrap gap-1">
                    {p.includes.map((item) => (
                      <li key={item} className="rounded bg-ink-800 px-1.5 py-0.5 text-xs text-muted-foreground">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                {p.documentId && <DocumentLink organizationId={organizationId} documentId={p.documentId} label="PDF da proposta" />}
              </li>
            ))}
          </ul>
        </>
      )}

      <ProposalDialog organizationId={organizationId} editing={dialog?.editing ?? null} open={dialog !== null} onClose={() => setDialog(null)} />
    </Card>
  );
}

// ── Decisões ───────────────────────────────────────────────────────────────

function DecisionCard({ organizationId, d, canWrite }: { organizationId: string; d: AccountingDecision; canWrite: boolean }) {
  const answer = useAnswerDecision(organizationId);
  const decide = useDecide(organizationId);
  const reopen = useReopenDecision(organizationId);
  const [mode, setMode] = useState<'answer' | 'decide' | null>(null);
  const [text, setText] = useState('');
  const [author, setAuthor] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!text.trim()) return setError(mode === 'decide' ? 'Escreva a decisão final.' : 'Escreva a resposta.');
    const done = {
      onSuccess: () => {
        setText('');
        setMode(null);
      },
      onError: (e: unknown) => setError(errorText(e, 'Não foi possível salvar.')),
    };
    if (mode === 'decide') decide.mutate({ id: d.id, finalDecision: text.trim() }, done);
    else answer.mutate({ id: d.id, text: text.trim(), author: author.trim() || undefined }, done);
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <span className="font-medium">{d.topic}</span>
      <p className="text-sm text-muted-foreground">{d.question}</p>
      {d.finalDecision && (
        <p className="rounded-md bg-positive-500/10 px-3 py-2 text-sm">
          <span className="text-xs text-positive-500">Decisão{d.decidedAt && ` · ${fmtDateTime(d.decidedAt)}`}</span>
          <br />
          {d.finalDecision}
        </p>
      )}
      {d.answers.length > 0 && (
        <ol className="flex flex-col gap-1.5 border-l border-border pl-3">
          {d.answers.map((a, i) => (
            <li key={`${a.at}-${i}`} className="text-sm">
              <span className="text-xs text-muted-foreground">
                {a.author} · {fmtDateTime(a.at)}
              </span>
              <p className="whitespace-pre-wrap">{a.text}</p>
            </li>
          ))}
        </ol>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setMode(mode === 'answer' ? null : 'answer')}>
            Registrar resposta
          </Button>
          {d.status === 'DECIDIDO' ? (
            <Button size="sm" variant="ghost" isLoading={reopen.isPending} onClick={() => reopen.mutate(d.id)}>
              Reabrir
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setMode(mode === 'decide' ? null : 'decide')}>
              Decidir
            </Button>
          )}
        </div>
      )}
      {mode && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          {mode === 'answer' && (
            <Field label="Quem respondeu (opcional)">
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Ex.: Contador — Escritório X" />
            </Field>
          )}
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === 'decide' ? 'Decisão final' : 'Resposta'} />
          <FormError message={error} />
          <Button type="submit" size="sm" variant="secondary" className="w-fit" isLoading={answer.isPending || decide.isPending}>
            {mode === 'decide' ? 'Registrar decisão' : 'Salvar resposta'}
          </Button>
        </form>
      )}
    </li>
  );
}

function DecisionsSection({ organizationId, canWrite }: { organizationId: string; canWrite: boolean }) {
  const decisions = useDecisions(organizationId);
  const loadDefaults = useLoadDefaultDecisions(organizationId);
  const create = useCreateDecision(organizationId);
  const [adding, setAdding] = useState(false);
  const [topic, setTopic] = useState('');
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rows = decisions.data ?? [];
  const seeded = rows.filter((d) => d.seedKey).length;
  const [filter, setFilter] = useState<AccountingDecisionStatus>('PENDENTE');
  const visible = rows.filter((d) => d.status === filter);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3">Decisões com o contador</h2>
        {canWrite && (
          <div className="flex gap-2">
            {seeded < 13 && (
              <Button size="sm" variant="secondary" isLoading={loadDefaults.isPending} onClick={() => loadDefaults.mutate()}>
                Carregar decisões padrão
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}>
              Nova pergunta
            </Button>
          </div>
        )}
      </div>
      {adding && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!topic.trim() || !question.trim()) return setError('Preencha tema e pergunta.');
            create.mutate(
              { topic: topic.trim(), question: question.trim() },
              {
                onSuccess: () => {
                  setTopic('');
                  setQuestion('');
                  setAdding(false);
                },
                onError: (err) => setError(errorText(err, 'Não foi possível criar.')),
              },
            );
          }}
        >
          <Field label="Tema">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
          </Field>
          <Field label="Pergunta">
            <Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} />
          </Field>
          <FormError message={error} />
          <Button type="submit" size="sm" variant="secondary" className="w-fit" isLoading={create.isPending}>
            Criar
          </Button>
        </form>
      )}
      {decisions.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma decisão registrada. Carregue as decisões padrão da passagem MEI → ME.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar decisões por status">
            {(['PENDENTE', 'EM_ANALISE', 'DECIDIDO'] as AccountingDecisionStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={filter === status}
                onClick={() => setFilter(status)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm transition-colors',
                  filter === status ? 'bg-accent-500/15 text-accent-500' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {DECISION_STATUS_LABELS[status]} · {rows.filter((d) => d.status === status).length}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada aqui.</p>
          ) : (
            <ul className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((d) => (
                <DecisionCard key={d.id} organizationId={organizationId} d={d} canWrite={canWrite} />
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

export default function ContadorPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const role = membership?.role;
  const seesFinance = Boolean(role && OPSGOV_FINANCE_ROLES.includes(role));
  const canWrite = Boolean(role && OPSGOV_WRITE_ROLES.includes(role));

  return (
    <div className="flex flex-col gap-6">
      {seesFinance && <ProposalsSection organizationId={organizationId} />}
      <DecisionsSection organizationId={organizationId} canWrite={canWrite} />
    </div>
  );
}
