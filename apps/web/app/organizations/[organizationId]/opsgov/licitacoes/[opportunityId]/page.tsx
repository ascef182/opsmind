'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Circle, ExternalLink, Trash2 } from 'lucide-react';
import { parseReaisToCents } from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useCustomers } from '@/lib/customers/use-customers';
import {
  useAddRequirement,
  useChangeOpportunityStatus,
  useConvertOpportunity,
  useOpportunity,
  useRemoveRequirement,
  useTechnicalCertificates,
  useUpdateOpportunity,
  useUpdateRequirement,
} from '@/lib/opsgov/use-procurement';
import {
  CERTIFICATE_TYPE_LABELS,
  OPSGOV_CONVERT_ROLES,
  OPSGOV_WRITE_ROLES,
  PROCUREMENT_MODALITY_LABELS,
  PROCUREMENT_STATUS_LABELS,
  REQUIREMENT_TYPE_LABELS,
  STATUSES_REQUIRING_REASON,
  type CertificateType,
  type OpportunityDetail,
  type ProcurementRequirementType,
  type ProcurementStatus,
  type Requirement,
} from '@/lib/opsgov/types';
import { brl, centsToReaisInput, fmtDate, todayKey } from '@/lib/finance/format';
import { ApiError } from '@/lib/api-client';
import type { UploadedDocument } from '@/lib/documents/files';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/finance/finance-ui';
import { DocumentField, DocumentLink } from '@/components/opsgov/document-field';
import { ProcurementStatusPill, ReadinessBar, labelOptions } from '@/components/opsgov/procurement-ui';
import { cn } from '@/lib/utils';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

function EditDialog({ organizationId, o, open, onClose }: { organizationId: string; o: OpportunityDetail; open: boolean; onClose: () => void }) {
  const update = useUpdateOpportunity(organizationId, o.id);
  const [sessionDate, setSessionDate] = useState(o.sessionDate ?? '');
  const [proposalDeadline, setProposalDeadline] = useState(o.proposalDeadline ?? '');
  const [estimated, setEstimated] = useState(o.estimatedValueCents === null ? '' : centsToReaisInput(o.estimatedValueCents));
  const [editalUrl, setEditalUrl] = useState(o.editalUrl ?? '');
  const [notes, setNotes] = useState(o.notes ?? '');
  const [edital, setEdital] = useState<UploadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open_ = o.nextStatuses.length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const estimatedValueCents = estimated.trim() ? parseReaisToCents(estimated) : null;
    if (estimated.trim() && estimatedValueCents === null) return setError('Valor estimado inválido.');
    update.mutate(
      open_
        ? {
            sessionDate: sessionDate || null,
            proposalDeadline: proposalDeadline || null,
            estimatedValueCents,
            editalUrl: editalUrl.trim() || null,
            notes: notes.trim() || null,
            ...(edital ? { editalDocumentId: edital.id } : {}),
          }
        : { notes: notes.trim() || null },
      { onSuccess: onClose, onError: (e) => setError(errorText(e, 'Não foi possível salvar.')) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar licitação</DialogTitle>
          <DialogDescription>
            {open_ ? 'Mudar a data da sessão recalcula a prontidão.' : 'Licitação encerrada: só as anotações podem mudar.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {open_ && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Sessão">
                  <Input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
                </Field>
                <Field label="Prazo da proposta">
                  <Input type="date" value={proposalDeadline} onChange={(e) => setProposalDeadline(e.target.value)} />
                </Field>
                <Field label="Valor estimado (R$)">
                  <Input inputMode="decimal" value={estimated} onChange={(e) => setEstimated(e.target.value)} />
                </Field>
              </div>
              <Field label="Link do edital">
                <Input type="url" value={editalUrl} onChange={(e) => setEditalUrl(e.target.value)} placeholder="https://" />
              </Field>
              {!o.editalDocumentId && (
                <DocumentField organizationId={organizationId} value={edital} onChange={setEdital} label="PDF do edital (opcional)" />
              )}
            </>
          )}
          <Field label="Anotações">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={update.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusActions({ organizationId, o }: { organizationId: string; o: OpportunityDetail }) {
  const change = useChangeOpportunityStatus(organizationId, o.id);
  const [pendingReason, setPendingReason] = useState<ProcurementStatus | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (o.nextStatuses.length === 0) return null;

  function go(status: ProcurementStatus, withReason?: string) {
    setError(null);
    change.mutate(
      { status, reason: withReason },
      {
        onSuccess: () => {
          setPendingReason(null);
          setReason('');
        },
        onError: (e) => setError(errorText(e, 'Não foi possível mudar o status.')),
      },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!o.readiness.ready && o.nextStatuses.includes('PROPOSTA') && (
        <p className="text-xs text-accent-500">
          {o.readiness.total === 0
            ? 'O checklist de habilitação ainda está vazio.'
            : `${o.readiness.blockers.length} pendência(s) de habilitação ainda abertas.`}{' '}
          Avançar é decisão sua; a pendência continua visível.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {o.nextStatuses.map((status) => {
          const needsReason = STATUSES_REQUIRING_REASON.includes(status);
          return (
            <Button
              key={status}
              size="sm"
              variant={needsReason ? 'ghost' : 'secondary'}
              isLoading={change.isPending && change.variables?.status === status}
              onClick={() => (needsReason ? setPendingReason(status) : go(status))}
            >
              {needsReason ? `Marcar como ${PROCUREMENT_STATUS_LABELS[status].toLowerCase()}` : `Mover para ${PROCUREMENT_STATUS_LABELS[status].toLowerCase()}`}
            </Button>
          );
        })}
      </div>
      {pendingReason && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return setError('Informe o motivo.');
            go(pendingReason, reason.trim());
          }}
        >
          <Field label={`Motivo (${PROCUREMENT_STATUS_LABELS[pendingReason].toLowerCase()})`}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: preço acima do vencedor" />
          </Field>
          <Button type="submit" size="sm" variant="secondary" isLoading={change.isPending}>
            Confirmar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPendingReason(null)}>
            Cancelar
          </Button>
        </form>
      )}
      <FormError message={error} />
    </div>
  );
}

function RequirementRow({
  organizationId,
  opportunityId,
  r,
  canEdit,
  technicalOptions,
}: {
  organizationId: string;
  opportunityId: string;
  r: Requirement;
  canEdit: boolean;
  technicalOptions: Array<{ id: string; label: string }>;
}) {
  const update = useUpdateRequirement(organizationId, opportunityId);
  const remove = useRemoveRequirement(organizationId, opportunityId);
  const [proof, setProof] = useState<UploadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const manual = r.type === 'DOCUMENTO' || r.type === 'DECLARACAO';
  const onError = (e: unknown) => setError(errorText(e, 'Não foi possível salvar.'));

  const detail =
    r.type === 'CERTIDAO' && r.certificateType
      ? CERTIFICATE_TYPE_LABELS[r.certificateType]
      : r.type === 'CNAE'
        ? r.requiredCnae
        : r.type === 'ATESTADO' && r.technicalCertificate
          ? r.technicalCertificate.issuer
          : null;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-1 gap-2">
        {r.met ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive-500" aria-label="Atendido" />
        ) : (
          <Circle className="mt-0.5 size-4 shrink-0 text-negative-500" aria-label="Pendente" />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm">{r.description}</span>
          <span className="text-xs text-muted-foreground">
            {REQUIREMENT_TYPE_LABELS[r.type]}
            {detail && ` · ${detail}`} · <span className={r.met ? 'text-positive-500' : 'text-negative-500'}>{r.reason}</span>
            {r.source === 'AI_SUGGESTION_CONFIRMED' && ' · sugerido pela IA, confirmado'}
          </span>
          {r.documentId && <DocumentLink organizationId={organizationId} documentId={r.documentId} />}
          {canEdit && r.type === 'ATESTADO' && (
            <Select
              className="mt-1 max-w-xs"
              aria-label="Atestado que atende"
              value={r.technicalCertificate?.id ?? ''}
              onChange={(e) => update.mutate({ id: r.id, technicalCertificateId: e.target.value || null }, { onError })}
            >
              <option value="">Nenhum atestado vinculado</option>
              {technicalOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
          {canEdit && manual && !r.met && (
            <div className="mt-1 flex flex-wrap items-end gap-2">
              <DocumentField organizationId={organizationId} value={proof} onChange={setProof} label="Comprovante (PDF, opcional)" />
              <Button
                size="sm"
                variant="secondary"
                isLoading={update.isPending}
                onClick={() =>
                  update.mutate(
                    { id: r.id, manuallyMet: true, ...(proof ? { documentId: proof.id } : {}) },
                    { onSuccess: () => setProof(null), onError },
                  )
                }
              >
                Marcar atendido
              </Button>
            </div>
          )}
          <FormError message={error} />
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1">
          {manual && r.met && (
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: r.id, manuallyMet: false }, { onError })}>
              Desmarcar
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remover ${r.description}`}
            isLoading={remove.isPending}
            onClick={() => remove.mutate(r.id, { onError })}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}

function AddRequirementForm({
  organizationId,
  opportunityId,
  technicalOptions,
}: {
  organizationId: string;
  opportunityId: string;
  technicalOptions: Array<{ id: string; label: string }>;
}) {
  const add = useAddRequirement(organizationId, opportunityId);
  const [type, setType] = useState<ProcurementRequirementType>('CERTIDAO');
  const [description, setDescription] = useState('');
  const [certificateType, setCertificateType] = useState<CertificateType>('CND_FEDERAL');
  const [requiredCnae, setRequiredCnae] = useState('');
  const [technicalCertificateId, setTechnicalCertificateId] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const fallback = type === 'CERTIDAO' ? CERTIFICATE_TYPE_LABELS[certificateType] : type === 'CNAE' ? `CNAE ${requiredCnae}` : '';
    const text = description.trim() || fallback;
    if (!text) return setError('Descreva o requisito como está no edital.');
    if (type === 'CNAE' && !requiredCnae.trim()) return setError('Informe o CNAE exigido.');
    add.mutate(
      {
        type,
        description: text,
        certificateType: type === 'CERTIDAO' ? certificateType : undefined,
        requiredCnae: type === 'CNAE' ? requiredCnae.trim() : undefined,
        technicalCertificateId: type === 'ATESTADO' && technicalCertificateId ? technicalCertificateId : undefined,
      },
      {
        onSuccess: () => {
          setDescription('');
          setRequiredCnae('');
        },
        onError: (e) => setError(errorText(e, 'Não foi possível adicionar.')),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as ProcurementRequirementType)}>
            {labelOptions(REQUIREMENT_TYPE_LABELS)}
          </Select>
        </Field>
        {type === 'CERTIDAO' && (
          <Field label="Certidão">
            <Select value={certificateType} onChange={(e) => setCertificateType(e.target.value as CertificateType)}>
              {labelOptions(CERTIFICATE_TYPE_LABELS)}
            </Select>
          </Field>
        )}
        {type === 'CNAE' && (
          <Field label="CNAE exigido">
            <Input value={requiredCnae} onChange={(e) => setRequiredCnae(e.target.value)} placeholder="0000-0/00" />
          </Field>
        )}
        {type === 'ATESTADO' && (
          <Field label="Atestado que atende (opcional)">
            <Select value={technicalCertificateId} onChange={(e) => setTechnicalCertificateId(e.target.value)}>
              <option value="">Vincular depois</option>
              {technicalOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Descrição (como está no edital)">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: item 8.2.1, prova de regularidade com o FGTS" />
      </Field>
      <FormError message={error} />
      <Button type="submit" size="sm" variant="secondary" className="w-fit" isLoading={add.isPending}>
        Adicionar ao checklist
      </Button>
    </form>
  );
}

function ConvertCard({ organizationId, o }: { organizationId: string; o: OpportunityDetail }) {
  const convert = useConvertOpportunity(organizationId, o.id);
  const customers = useCustomers(organizationId);
  const [customerId, setCustomerId] = useState('');
  const [billing, setBilling] = useState<'ONE_TIME' | 'MONTHLY'>('ONE_TIME');
  const [value, setValue] = useState(o.estimatedValueCents ? centsToReaisInput(o.estimatedValueCents) : '');
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState('');
  const [generateBilling, setGenerateBilling] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const valueCents = parseReaisToCents(value);
    if (!valueCents) return setError('Informe o valor do contrato.');
    convert.mutate(
      { customerId: customerId || undefined, billing, valueCents, startDate, endDate: endDate || undefined, generateBilling },
      { onError: (e) => setError(errorText(e, 'Não foi possível converter.')) },
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-h3">Virar cliente e contrato</h2>
      <p className="text-sm text-muted-foreground">
        Cria (ou reaproveita) o cliente e lança o contrato no Financeiro, com as cobranças. Acontece uma vez só.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Cliente">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Novo cliente: {o.agency}</option>
            {(customers.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cobrança">
            <Select value={billing} onChange={(e) => setBilling(e.target.value as 'ONE_TIME' | 'MONTHLY')}>
              <option value="ONE_TIME">Valor único</option>
              <option value="MONTHLY">Mensal</option>
            </Select>
          </Field>
          <Field label={billing === 'MONTHLY' ? 'Valor mensal (R$)' : 'Valor (R$)'}>
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Início">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Fim (opcional)">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={generateBilling} onChange={(e) => setGenerateBilling(e.target.checked)} />
          Gerar as cobranças no Financeiro
        </label>
        <FormError message={error} />
        <Button type="submit" size="sm" className="w-fit" isLoading={convert.isPending}>
          Criar cliente e contrato
        </Button>
      </form>
    </Card>
  );
}

export default function LicitacaoPage() {
  const { organizationId, opportunityId } = useParams<{ organizationId: string; opportunityId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const opportunity = useOpportunity(organizationId, opportunityId);
  const technical = useTechnicalCertificates(organizationId);
  const [editing, setEditing] = useState(false);
  const canWrite = Boolean(membership && OPSGOV_WRITE_ROLES.includes(membership.role));
  const canConvert = Boolean(membership && OPSGOV_CONVERT_ROLES.includes(membership.role));
  const back = `/organizations/${organizationId}/opsgov/licitacoes`;

  if (opportunity.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!opportunity.data) {
    return (
      <p className="text-sm text-muted-foreground">
        Licitação não encontrada.{' '}
        <Link href={back} className="text-accent-500 hover:underline">
          Voltar
        </Link>
      </p>
    );
  }
  const o = opportunity.data;
  const isOpen = o.nextStatuses.length > 0;
  const technicalOptions = (technical.data ?? []).map((t) => ({ id: t.id, label: `${t.issuer} (${fmtDate(t.periodStart)})` }));

  return (
    <div className="flex flex-col gap-6">
      <Link href={back} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Licitações
      </Link>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-h2">{o.agency}</h2>
            <p className="text-sm text-muted-foreground">
              {PROCUREMENT_MODALITY_LABELS[o.modality]}
              {o.processNumber && ` · ${o.processNumber}`}
              {o.agencyCode && ` · UASG ${o.agencyCode}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ProcurementStatusPill status={o.status} />
            {canWrite && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Editar
              </Button>
            )}
          </div>
        </div>
        <p className="whitespace-pre-line text-sm">{o.object}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Sessão</dt>
            <dd>{fmtDate(o.sessionDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Prazo da proposta</dt>
            <dd>{fmtDate(o.proposalDeadline)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Valor estimado</dt>
            <dd className="tabular-nums">{o.estimatedValueCents === null ? '—' : brl(o.estimatedValueCents)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Edital</dt>
            <dd className="flex flex-wrap gap-3">
              {o.editalUrl && (
                <a href={o.editalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-500 hover:underline">
                  <ExternalLink className="size-3" aria-hidden /> portal
                </a>
              )}
              {o.editalDocumentId && <DocumentLink organizationId={organizationId} documentId={o.editalDocumentId} label="PDF" />}
              {!o.editalUrl && !o.editalDocumentId && '—'}
            </dd>
          </div>
        </dl>
        {o.notes && <p className="whitespace-pre-line rounded-md bg-ink-900/40 p-3 text-sm text-muted-foreground">{o.notes}</p>}
        {canWrite && <StatusActions organizationId={organizationId} o={o} />}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-h3">Checklist de habilitação</h2>
            <ReadinessBar readiness={o.readiness} />
          </div>
          {o.requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum requisito ainda. Copie do edital as exigências de habilitação: certidões, CNAE, atestados e declarações.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {o.requirements.map((r) => (
                <RequirementRow
                  key={r.id}
                  organizationId={organizationId}
                  opportunityId={o.id}
                  r={r}
                  canEdit={canWrite && isOpen}
                  technicalOptions={technicalOptions}
                />
              ))}
            </ul>
          )}
          {canWrite && isOpen && (
            <AddRequirementForm organizationId={organizationId} opportunityId={o.id} technicalOptions={technicalOptions} />
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-h3">Prontidão</h2>
            <p className="text-sm text-muted-foreground">
              Avaliada em {fmtDate(o.readiness.referenceDate)}
              {o.sessionDate ? ' (data da sessão)' : ' (hoje; sem data de sessão)'}. {o.readiness.metCount} de {o.readiness.total} atendidos.
            </p>
            {o.readiness.ready ? (
              <p className="flex items-center gap-2 text-sm text-positive-500">
                <CheckCircle2 className="size-4" aria-hidden /> Pronta para a habilitação.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {o.readiness.blockers.map((b) => (
                  <li key={b} className="text-sm text-negative-500">
                    {b}
                  </li>
                ))}
                {o.readiness.total === 0 && <li className="text-sm text-muted-foreground">Monte o checklist para calcular.</li>}
              </ul>
            )}
          </Card>

          {o.status === 'GANHA' &&
            (o.contractId ? (
              <Card className="flex flex-col gap-2 p-5">
                <h2 className="text-h3">Contrato</h2>
                <p className="text-sm text-muted-foreground">Convertida em {fmtDate(o.convertedAt)}.</p>
                <div className="flex gap-3 text-sm">
                  {o.customerId && (
                    <Link href={`/organizations/${organizationId}/customers/${o.customerId}`} className="text-accent-500 hover:underline">
                      Ver cliente
                    </Link>
                  )}
                  <Link href={`/organizations/${organizationId}/finance/contracts`} className="text-accent-500 hover:underline">
                    Ver contratos
                  </Link>
                </div>
              </Card>
            ) : (
              canConvert && <ConvertCard organizationId={organizationId} o={o} />
            ))}

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-h3">Histórico</h2>
            <ol className="flex flex-col gap-2">
              {o.statusChanges.map((c) => (
                <li key={c.id} className="text-sm">
                  <span className={cn(c.toStatus === 'GANHA' && 'text-positive-500')}>{PROCUREMENT_STATUS_LABELS[c.toStatus]}</span>
                  <span className="text-xs text-muted-foreground"> · {fmtDate(c.createdAt.slice(0, 10))}</span>
                  {c.reason && <span className="block text-xs text-muted-foreground">{c.reason}</span>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {editing && <EditDialog organizationId={organizationId} o={o} open={editing} onClose={() => setEditing(false)} />}
    </div>
  );
}
