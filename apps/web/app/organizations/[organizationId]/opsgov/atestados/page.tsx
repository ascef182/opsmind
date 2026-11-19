'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { parseReaisToCents } from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useCustomers } from '@/lib/customers/use-customers';
import { useCompanyOverview } from '@/lib/opsgov/use-company';
import {
  useCreateTechnicalCertificate,
  useTechnicalCertificates,
  useUpdateTechnicalCertificate,
} from '@/lib/opsgov/use-procurement';
import { OPSGOV_WRITE_ROLES, REVENUE_GROUP_LABELS, type TechnicalCertificate } from '@/lib/opsgov/types';
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
import { DocumentField, DocumentLink } from '@/components/opsgov/document-field';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

function useActivityOptions(organizationId: string) {
  const company = useCompanyOverview(organizationId);
  return (company.data?.activities ?? [])
    .filter((a) => a.validTo === null)
    .map((a) => ({ id: a.id, label: `${a.cnae} · ${a.description}` }));
}

function NewTechnicalCertificateDialog({ organizationId, open, onClose }: { organizationId: string; open: boolean; onClose: () => void }) {
  const create = useCreateTechnicalCertificate(organizationId);
  const customers = useCustomers(organizationId);
  const activities = useActivityOptions(organizationId);
  const [issuer, setIssuer] = useState('');
  const [object, setObject] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [value, setValue] = useState('');
  const [companyActivityId, setCompanyActivityId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [proof, setProof] = useState<UploadedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!issuer.trim() || !object.trim() || !periodStart) return setError('Informe o emissor, o objeto e o início do serviço.');
    const valueCents = value.trim() ? parseReaisToCents(value) : undefined;
    if (valueCents === null) return setError('Valor inválido.');
    create.mutate(
      {
        issuer: issuer.trim(),
        object: object.trim(),
        periodStart,
        periodEnd: periodEnd || undefined,
        valueCents,
        companyActivityId: companyActivityId || undefined,
        customerId: customerId || undefined,
        documentId: proof?.id,
      },
      {
        onSuccess: () => {
          setProof(null);
          onClose();
        },
        onError: (e) => setError(errorText(e, 'Não foi possível registrar o atestado.')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar atestado</DialogTitle>
          <DialogDescription>
            Transcreva o que o atestado diz. Depois de registrado, só o CNAE, o PDF e as anotações podem mudar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Emissor (quem atesta)">
            <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          </Field>
          <Field label="Objeto (serviço prestado)">
            <Textarea rows={3} value={object} onChange={(e) => setObject(e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Início">
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </Field>
            <Field label="Fim (opcional)">
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </Field>
            <Field label="Valor (R$)">
              <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CNAE relacionado">
              <Select value={companyActivityId} onChange={(e) => setCompanyActivityId(e.target.value)}>
                <option value="">Nenhum</option>
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cliente (opcional)">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Nenhum</option>
                {(customers.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <DocumentField organizationId={organizationId} value={proof} onChange={setProof} label="PDF do atestado (opcional)" />
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

function TechnicalCertificateRow({
  organizationId,
  t,
  canWrite,
  activities,
}: {
  organizationId: string;
  t: TechnicalCertificate;
  canWrite: boolean;
  activities: Array<{ id: string; label: string }>;
}) {
  const update = useUpdateTechnicalCertificate(organizationId);
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(errorText(e, 'Não foi possível salvar.'));

  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm">{t.issuer}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {fmtDate(t.periodStart)} a {t.periodEnd ? fmtDate(t.periodEnd) : 'atual'}
          {t.valueCents !== null && ` · ${brl(t.valueCents)}`}
        </span>
      </div>
      <p className="whitespace-pre-line text-sm text-muted-foreground">{t.object}</p>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {canWrite ? (
          <Select
            className="max-w-xs"
            aria-label="CNAE relacionado"
            value={t.companyActivity?.id ?? ''}
            onChange={(e) => update.mutate({ id: t.id, companyActivityId: e.target.value || null }, { onError })}
          >
            <option value="">Sem CNAE vinculado</option>
            {t.companyActivity && !activities.some((a) => a.id === t.companyActivity!.id) && (
              <option value={t.companyActivity.id}>{t.companyActivity.cnae} (encerrado)</option>
            )}
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        ) : (
          <span>{t.companyActivity ? `${t.companyActivity.cnae} · ${REVENUE_GROUP_LABELS[t.companyActivity.revenueGroup]}` : 'Sem CNAE'}</span>
        )}
        {t.customer && <span>Cliente: {t.customer.name}</span>}
        {t.documentId ? (
          <DocumentLink organizationId={organizationId} documentId={t.documentId} label="PDF do atestado" />
        ) : (
          canWrite && (
            <DocumentField
              organizationId={organizationId}
              value={null}
              label="Sem PDF anexado"
              onChange={(doc) => doc && update.mutate({ id: t.id, documentId: doc.id }, { onError })}
            />
          )
        )}
      </div>
      <FormError message={error} />
    </li>
  );
}

export default function AtestadosPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const technical = useTechnicalCertificates(organizationId);
  const activities = useActivityOptions(organizationId);
  const [creating, setCreating] = useState(false);
  const canWrite = Boolean(membership && OPSGOV_WRITE_ROLES.includes(membership.role));

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-h3">Atestados de capacidade técnica</h2>
          <p className="text-sm text-muted-foreground">Provam serviços já prestados. Vincule cada um ao CNAE para saber em que área você tem experiência comprovada.</p>
        </div>
        {canWrite && (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            Registrar atestado
          </Button>
        )}
      </div>
      {technical.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (technical.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum atestado registrado.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {technical.data!.map((t) => (
            <TechnicalCertificateRow key={t.id} organizationId={organizationId} t={t} canWrite={canWrite} activities={activities} />
          ))}
        </ul>
      )}
      <NewTechnicalCertificateDialog organizationId={organizationId} open={creating} onClose={() => setCreating(false)} />
    </Card>
  );
}
