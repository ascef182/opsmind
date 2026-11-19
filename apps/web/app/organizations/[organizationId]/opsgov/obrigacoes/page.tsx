'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import {
  useCertificates,
  useCompleteObligation,
  useCreateCertificate,
  useCreateObligation,
  useDismissObligation,
  useObligations,
  useUpdateCertificate,
} from '@/lib/opsgov/use-compliance';
import {
  CERTIFICATE_STATUS_LABELS,
  CERTIFICATE_TYPE_LABELS,
  OBLIGATION_STATUS_LABELS,
  OBLIGATION_TYPE_LABELS,
  OPSGOV_WRITE_ROLES,
  RECURRENCE_LABELS,
  type CertificateStatus,
  type Certificate,
  type CertificateType,
  type ComplianceObligationType,
  type Obligation,
  type ObligationRecurrence,
} from '@/lib/opsgov/types';
import { fmtDate, todayKey } from '@/lib/finance/format';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/finance/finance-ui';
import { DocumentField, DocumentLink } from '@/components/opsgov/document-field';
import type { UploadedDocument } from '@/lib/documents/files';
import { cn } from '@/lib/utils';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

function options<T extends string>(labels: Record<T, string>) {
  return (Object.keys(labels) as T[]).map((key) => (
    <option key={key} value={key}>
      {labels[key]}
    </option>
  ));
}

function DueBadge({ days }: { days: number }) {
  const label = days < 0 ? `atrasada ${-days} dia${days === -1 ? '' : 's'}` : days === 0 ? 'vence hoje' : `em ${days} dia${days === 1 ? '' : 's'}`;
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-xs',
        days < 0 ? 'bg-negative-500/15 text-negative-500' : days <= 7 ? 'bg-accent-500/15 text-accent-500' : 'bg-ink-800 text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
}

const CERT_STATUS_CLASS: Record<CertificateStatus, string> = {
  VALIDA: 'bg-positive-500/15 text-positive-500',
  VENCENDO: 'bg-accent-500/15 text-accent-500',
  VENCIDA: 'bg-negative-500/15 text-negative-500',
};

function describeRule(o: Obligation): string {
  if (o.recurrence === 'MONTHLY') return `Mensal, dia ${o.dueDay}`;
  if (o.recurrence === 'YEARLY') return `Anual, ${String(o.dueDay).padStart(2, '0')}/${String(o.dueMonth).padStart(2, '0')}`;
  return 'Data única';
}

function NewObligationDialog({ organizationId, open, onClose }: { organizationId: string; open: boolean; onClose: () => void }) {
  const create = useCreateObligation(organizationId);
  const [type, setType] = useState<ComplianceObligationType>('DAS');
  const [title, setTitle] = useState('');
  const [recurrence, setRecurrence] = useState<ObligationRecurrence>('MONTHLY');
  const [dueDay, setDueDay] = useState('20');
  const [dueMonth, setDueMonth] = useState('5');
  const [firstDueDate, setFirstDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Dê um nome à obrigação.');
    if (recurrence === 'ONCE' && !firstDueDate) return setError('Informe a data do vencimento.');
    create.mutate(
      {
        type,
        title: title.trim(),
        recurrence,
        dueDay: recurrence === 'ONCE' ? undefined : Number(dueDay),
        dueMonth: recurrence === 'YEARLY' ? Number(dueMonth) : undefined,
        firstDueDate: firstDueDate || undefined,
      },
      { onSuccess: onClose, onError: (e) => setError(errorText(e, 'Não foi possível criar a obrigação.')) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova obrigação</DialogTitle>
          <DialogDescription>Os lembretes chegam para donos e administradores 7 dias e 1 dia antes do vencimento.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select value={type} onChange={(e) => setType(e.target.value as ComplianceObligationType)}>
                {options(OBLIGATION_TYPE_LABELS)}
              </Select>
            </Field>
            <Field label="Recorrência">
              <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value as ObligationRecurrence)}>
                {options(RECURRENCE_LABELS)}
              </Select>
            </Field>
          </div>
          <Field label="Nome">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: DAS do Simples" />
          </Field>
          {recurrence !== 'ONCE' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Dia do vencimento">
                <Input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
              </Field>
              {recurrence === 'YEARLY' && (
                <Field label="Mês do vencimento">
                  <Input type="number" min={1} max={12} value={dueMonth} onChange={(e) => setDueMonth(e.target.value)} />
                </Field>
              )}
            </div>
          )}
          <Field
            label={recurrence === 'ONCE' ? 'Vencimento' : 'Primeiro vencimento (opcional)'}
            hint={recurrence === 'ONCE' ? undefined : 'Em branco: o próximo pela regra, a partir de hoje.'}
          >
            <Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={create.isPending}>
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewCertificateDialog({ organizationId, open, onClose }: { organizationId: string; open: boolean; onClose: () => void }) {
  const create = useCreateCertificate(organizationId);
  const [type, setType] = useState<CertificateType>('CND_FEDERAL');
  const [issuer, setIssuer] = useState('');
  const [code, setCode] = useState('');
  const [issuedOn, setIssuedOn] = useState(todayKey());
  const [validUntil, setValidUntil] = useState('');
  const [proof, setProof] = useState<UploadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!validUntil) return setError('Informe a validade.');
    create.mutate(
      { type, issuer: issuer.trim() || undefined, code: code.trim() || undefined, issuedOn, validUntil, documentId: proof?.id },
      {
        onSuccess: () => {
          setProof(null);
          onClose();
        }, onError: (e) => setError(errorText(e, 'Não foi possível registrar a certidão.')) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar certidão</DialogTitle>
          <DialogDescription>
            Renovou uma certidão? Registre a nova: a anterior fica no histórico e só a mais recente de cada tipo vale.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Tipo">
            <Select value={type} onChange={(e) => setType(e.target.value as CertificateType)}>
              {options(CERTIFICATE_TYPE_LABELS)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Órgão emissor">
              <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} />
            </Field>
            <Field label="Código de controle">
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label="Emissão">
              <Input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
            </Field>
            <Field label="Válida até">
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
          </div>
          <DocumentField organizationId={organizationId} value={proof} onChange={setProof} label="PDF da certidão (opcional)" />
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={create.isPending}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ObligationRow({ organizationId, o, canWrite }: { organizationId: string; o: Obligation; canWrite: boolean }) {
  const complete = useCompleteObligation(organizationId);
  const dismiss = useDismissObligation(organizationId);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completedOn, setCompletedOn] = useState(todayKey());
  const [proof, setProof] = useState<UploadedDocument | null>(null);
  const pending = o.status === 'PENDENTE';

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm">
          {o.title} <span className="text-xs text-muted-foreground">· {OBLIGATION_TYPE_LABELS[o.type]}</span>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {describeRule(o)}
          {pending ? (
            <>
              · vence {fmtDate(o.nextDueDate)} <DueBadge days={o.daysUntilDue} />
            </>
          ) : (
            <span>· {OBLIGATION_STATUS_LABELS[o.status]}</span>
          )}
        </span>
        {o.lastCompletion && (
          <span className="text-xs text-muted-foreground">
            Último cumprimento: vencimento {fmtDate(o.lastCompletion.dueDate)}, feito em {fmtDate(o.lastCompletion.completedOn)}
            {o.lastCompletion.documentId && (
              <>
                {' · '}
                <DocumentLink organizationId={organizationId} documentId={o.lastCompletion.documentId} />
              </>
            )}
          </span>
        )}
        <FormError message={error} />
      </div>
      {canWrite && pending && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDismissing(false);
              setCompleting((v) => !v);
            }}
          >
            Marcar cumprida
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCompleting(false);
              setDismissing((v) => !v);
            }}
          >
            Dispensar
          </Button>
        </div>
      )}
      {canWrite && pending && completing && (
        <form
          className="flex w-full flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            complete.mutate(
              { id: o.id, completedOn, documentId: proof?.id },
              {
                onSuccess: () => {
                  setCompleting(false);
                  setProof(null);
                },
                onError: (err) => setError(errorText(err, 'Não foi possível marcar.')),
              },
            );
          }}
        >
          <Field label={`Cumprida em (vencimento ${fmtDate(o.nextDueDate)})`}>
            <Input type="date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />
          </Field>
          <DocumentField organizationId={organizationId} value={proof} onChange={setProof} label="Guia ou recibo (PDF, opcional)" />
          <Button type="submit" size="sm" variant="secondary" isLoading={complete.isPending}>
            Confirmar
          </Button>
        </form>
      )}
      {canWrite && pending && dismissing && (
        <form
          className="flex w-full items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return setError('Informe o motivo.');
            dismiss.mutate(
              { id: o.id, reason: reason.trim() },
              { onError: (err) => setError(errorText(err, 'Não foi possível dispensar.')) },
            );
          }}
        >
          <Field label="Motivo para dispensar">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: deixou de ser MEI" />
          </Field>
          <Button type="submit" size="sm" variant="secondary" isLoading={dismiss.isPending}>
            Confirmar
          </Button>
        </form>
      )}
    </li>
  );
}

function CertificateRow({ organizationId, c, canWrite }: { organizationId: string; c: Certificate; canWrite: boolean }) {
  const update = useUpdateCertificate(organizationId);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className={cn('flex flex-wrap items-center justify-between gap-3 py-3', !c.isCurrent && 'opacity-60')}>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm">{CERTIFICATE_TYPE_LABELS[c.type]}</span>
        <span className="text-xs text-muted-foreground">
          Emitida {fmtDate(c.issuedOn)} · válida até {fmtDate(c.validUntil)}
          {c.issuer && ` · ${c.issuer}`}
          {!c.isCurrent && ' · substituída'}
        </span>
        {c.documentId ? (
          <DocumentLink organizationId={organizationId} documentId={c.documentId} label="PDF da certidão" />
        ) : (
          canWrite &&
          c.isCurrent && (
            <DocumentField
              organizationId={organizationId}
              value={null}
              label="Sem PDF anexado"
              onChange={(doc) =>
                doc && update.mutate({ id: c.id, documentId: doc.id }, { onError: (e) => setError(errorText(e, 'Não foi possível anexar.')) })
              }
            />
          )
        )}
        <FormError message={error} />
      </div>
      <span className={cn('rounded px-1.5 py-0.5 text-xs', CERT_STATUS_CLASS[c.status])}>
        {CERTIFICATE_STATUS_LABELS[c.status]}
        {c.isCurrent && c.status !== 'VENCIDA' && c.daysUntilExpiry <= 15 && ` · ${c.daysUntilExpiry} dia${c.daysUntilExpiry === 1 ? '' : 's'}`}
      </span>
    </li>
  );
}

export default function ObrigacoesPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const obligations = useObligations(organizationId);
  const certificates = useCertificates(organizationId);
  const [dialog, setDialog] = useState<'obligation' | 'certificate' | null>(null);
  const canWrite = Boolean(membership && OPSGOV_WRITE_ROLES.includes(membership.role));

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-h3">Obrigações</h2>
          {canWrite && (
            <Button size="sm" variant="secondary" onClick={() => setDialog('obligation')}>
              Nova obrigação
            </Button>
          )}
        </div>
        {obligations.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (obligations.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma obrigação cadastrada. Comece pelo DAS e pela declaração anual.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {obligations.data!.map((o) => (
              <ObligationRow key={o.id} organizationId={organizationId} o={o} canWrite={canWrite} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-h3">Certidões</h2>
          {canWrite && (
            <Button size="sm" variant="secondary" onClick={() => setDialog('certificate')}>
              Registrar certidão
            </Button>
          )}
        </div>
        {certificates.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (certificates.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma certidão registrada.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {certificates.data!.map((c) => (
              <CertificateRow key={c.id} organizationId={organizationId} c={c} canWrite={canWrite} />
            ))}
          </ul>
        )}
      </Card>

      <NewObligationDialog organizationId={organizationId} open={dialog === 'obligation'} onClose={() => setDialog(null)} />
      <NewCertificateDialog organizationId={organizationId} open={dialog === 'certificate'} onClose={() => setDialog(null)} />
    </div>
  );
}
