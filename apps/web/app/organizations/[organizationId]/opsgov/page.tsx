'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, OctagonX } from 'lucide-react';
import { useProcurementOverview } from '@/lib/opsgov/use-procurement';
import {
  CERTIFICATE_STATUS_LABELS,
  CERTIFICATE_TYPE_LABELS,
  PROCUREMENT_MODALITY_LABELS,
  REVENUE_GROUP_LABELS,
  type CertificateStatus,
} from '@/lib/opsgov/types';
import { brl, fmtDate } from '@/lib/finance/format';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ProcurementStatusPill, ReadinessBar } from '@/components/opsgov/procurement-ui';
import { cn } from '@/lib/utils';

const CERT_STATUS_CLASS: Record<CertificateStatus, string> = {
  VALIDA: 'bg-positive-500/15 text-positive-500',
  VENCENDO: 'bg-accent-500/15 text-accent-500',
  VENCIDA: 'bg-negative-500/15 text-negative-500',
};

export default function ProntidaoPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const overview = useProcurementOverview(organizationId);
  const base = `/organizations/${organizationId}/opsgov`;

  if (overview.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!overview.data) return <p className="text-sm text-negative-500">Não foi possível carregar a prontidão.</p>;
  const data = overview.data;
  const blockers = data.issues.filter((i) => i.severity === 'BLOCKER');
  const warnings = data.issues.filter((i) => i.severity === 'WARNING');

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h3">Prontidão geral</h2>
          <span className="text-xs text-muted-foreground">Situação em {fmtDate(data.today)}</span>
        </div>
        {data.issues.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-positive-500">
            <CheckCircle2 className="size-4" aria-hidden /> Nada bloqueando: cadastro, regime, CNAEs, certidões e obrigações em dia.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {blockers.map((issue) => (
              <li key={issue.message} className="flex items-start gap-2 text-sm text-negative-500">
                <OctagonX className="mt-0.5 size-4 shrink-0" aria-hidden /> {issue.message}
              </li>
            ))}
            {warnings.map((issue) => (
              <li key={issue.message} className="flex items-start gap-2 text-sm text-accent-500">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {issue.message}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h3">Licitações em andamento</h2>
          <Link href={`${base}/licitacoes`} className="text-sm text-accent-500 hover:underline">
            Ver todas
          </Link>
        </div>
        {data.openOpportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma licitação aberta. Cadastre as que estão no seu radar em Licitações.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.openOpportunities.map((o) => (
              <li key={o.id}>
                <Link href={`${base}/licitacoes/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-ink-900/40">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm">{o.agency}</span>
                    <span className="text-xs text-muted-foreground">
                      {PROCUREMENT_MODALITY_LABELS[o.modality]} · sessão {fmtDate(o.sessionDate)}
                      {o.readiness.blockerCount > 0 && ` · ${o.readiness.blockerCount} pendência(s)`}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <ReadinessBar readiness={o.readiness} />
                    <ProcurementStatusPill status={o.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-h3">Certidões vigentes</h2>
            <Link href={`${base}/obrigacoes`} className="text-sm text-accent-500 hover:underline">
              Gerenciar
            </Link>
          </div>
          {data.certificates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma certidão registrada.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.certificates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    {CERTIFICATE_TYPE_LABELS[c.type]}
                    <span className="block text-xs text-muted-foreground">até {fmtDate(c.validUntil)}</span>
                  </span>
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs', CERT_STATUS_CLASS[c.status])}>
                    {CERTIFICATE_STATUS_LABELS[c.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-h3">CNAEs vigentes</h2>
            <Link href={`${base}/empresa`} className="text-sm text-accent-500 hover:underline">
              Empresa
            </Link>
          </div>
          {data.activeActivities.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum CNAE vigente.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.activeActivities.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="tabular-nums">{a.cnae}</span>
                  {a.isPrimary && <span className="ml-1 text-xs text-accent-500">principal</span>}
                  <span className="block text-xs text-muted-foreground">{a.description}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-h3">Atestados técnicos</h2>
            <Link href={`${base}/atestados`} className="text-sm text-accent-500 hover:underline">
              Gerenciar
            </Link>
          </div>
          {data.technicalCertificatesByGroup.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum atestado. Peça aos clientes atuais: são exigidos na maioria dos editais.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.technicalCertificatesByGroup.map((g) => (
                <li key={g.revenueGroup ?? 'none'} className="flex items-center justify-between gap-2 text-sm">
                  <span>{g.revenueGroup ? REVENUE_GROUP_LABELS[g.revenueGroup] : 'Sem CNAE vinculado'}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {g.count} · {brl(g.totalValueCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
