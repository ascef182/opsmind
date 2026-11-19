'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { parseReaisToCents } from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useCreateOpportunity, useOpportunities } from '@/lib/opsgov/use-procurement';
import {
  OPSGOV_WRITE_ROLES,
  PROCUREMENT_MODALITY_LABELS,
  type OpportunitySummary,
  type ProcurementModality,
} from '@/lib/opsgov/types';
import { brl, fmtDate } from '@/lib/finance/format';
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
import { DocumentField } from '@/components/opsgov/document-field';
import { ProcurementStatusPill, ReadinessBar, labelOptions } from '@/components/opsgov/procurement-ui';
import { cn } from '@/lib/utils';

const OPEN = new Set(['RADAR', 'ANALISE', 'PROPOSTA', 'DISPUTA']);

function NewOpportunityDialog({ organizationId, open, onClose }: { organizationId: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const create = useCreateOpportunity(organizationId);
  const [agency, setAgency] = useState('');
  const [agencyCode, setAgencyCode] = useState('');
  const [processNumber, setProcessNumber] = useState('');
  const [modality, setModality] = useState<ProcurementModality>('PREGAO_ELETRONICO');
  const [object, setObject] = useState('');
  const [editalUrl, setEditalUrl] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [proposalDeadline, setProposalDeadline] = useState('');
  const [estimated, setEstimated] = useState('');
  const [edital, setEdital] = useState<UploadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!agency.trim() || !object.trim()) return setError('Informe o órgão e o objeto.');
    const estimatedValueCents = estimated.trim() ? parseReaisToCents(estimated) : undefined;
    if (estimatedValueCents === null) return setError('Valor estimado inválido.');
    create.mutate(
      {
        agency: agency.trim(),
        agencyCode: agencyCode.trim() || undefined,
        processNumber: processNumber.trim() || undefined,
        modality,
        object: object.trim(),
        editalUrl: editalUrl.trim() || undefined,
        sessionDate: sessionDate || undefined,
        proposalDeadline: proposalDeadline || undefined,
        estimatedValueCents,
        editalDocumentId: edital?.id,
      },
      {
        onSuccess: (created) => router.push(`/organizations/${organizationId}/opsgov/licitacoes/${created.id}`),
        onError: (e) => setError(e instanceof ApiError || e instanceof Error ? e.message : 'Não foi possível cadastrar.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova licitação</DialogTitle>
          <DialogDescription>Entra no radar. O checklist de habilitação é montado na página da licitação.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Órgão">
            <Input value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="Ex.: Prefeitura de São Paulo" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="UASG / código do órgão">
              <Input value={agencyCode} onChange={(e) => setAgencyCode(e.target.value)} />
            </Field>
            <Field label="Nº do processo ou edital">
              <Input value={processNumber} onChange={(e) => setProcessNumber(e.target.value)} />
            </Field>
          </div>
          <Field label="Modalidade">
            <Select value={modality} onChange={(e) => setModality(e.target.value as ProcurementModality)}>
              {labelOptions(PROCUREMENT_MODALITY_LABELS)}
            </Select>
          </Field>
          <Field label="Objeto">
            <Textarea rows={3} value={object} onChange={(e) => setObject(e.target.value)} />
          </Field>
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
          <DocumentField organizationId={organizationId} value={edital} onChange={setEdital} label="PDF do edital (opcional)" />
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={create.isPending}>
              Cadastrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OpportunityRow({ organizationId, o }: { organizationId: string; o: OpportunitySummary }) {
  return (
    <li>
      <Link
        href={`/organizations/${organizationId}/opsgov/licitacoes/${o.id}`}
        className="grid gap-2 py-3 hover:bg-ink-900/40 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-6"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm">{o.agency}</span>
          <span className="truncate text-xs text-muted-foreground">{o.object}</span>
          <span className="text-xs text-muted-foreground">
            {PROCUREMENT_MODALITY_LABELS[o.modality]}
            {o.processNumber && ` · ${o.processNumber}`}
            {o.estimatedValueCents !== null && ` · ${brl(o.estimatedValueCents)}`}
          </span>
        </span>
        <span className="flex flex-col gap-1 text-xs text-muted-foreground md:items-end">
          <span>Sessão {fmtDate(o.sessionDate)}</span>
          <ReadinessBar readiness={o.readiness} />
        </span>
        <span className="flex items-center gap-2">
          <ProcurementStatusPill status={o.status} />
          {o.converted && <span className="text-xs text-positive-500">contrato criado</span>}
        </span>
      </Link>
    </li>
  );
}

export default function LicitacoesPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const opportunities = useOpportunities(organizationId);
  const [view, setView] = useState<'open' | 'closed'>('open');
  const [creating, setCreating] = useState(false);
  const canWrite = Boolean(membership && OPSGOV_WRITE_ROLES.includes(membership.role));

  const rows = useMemo(
    () => (opportunities.data ?? []).filter((o) => OPEN.has(o.status) === (view === 'open')),
    [opportunities.data, view],
  );

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" role="tablist" aria-label="Filtrar licitações">
          {(['open', 'closed'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                view === v ? 'bg-ink-800 text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v === 'open' ? 'Em andamento' : 'Encerradas'}
            </button>
          ))}
        </div>
        {canWrite && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            Nova licitação
          </Button>
        )}
      </div>
      {opportunities.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {view === 'open' ? 'Nenhuma licitação em andamento.' : 'Nenhuma licitação encerrada.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((o) => (
            <OpportunityRow key={o.id} organizationId={organizationId} o={o} />
          ))}
        </ul>
      )}
      <NewOpportunityDialog organizationId={organizationId} open={creating} onClose={() => setCreating(false)} />
    </Card>
  );
}
