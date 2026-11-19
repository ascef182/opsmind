'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useCampaignOverview, useCreateCampaign } from '@/lib/campaigns/use-campaigns';
import {
  CAMPAIGN_KIND_LABELS,
  CAMPAIGN_STATUS_LABELS,
  type CampaignOverviewFilter,
  type CampaignWithStats,
} from '@/lib/campaigns/types';
import { HARVEY_CONTROL_ROLES, type CampaignStatus } from '@/lib/harvey/types';
import { SCRAPE_SOURCE_LABELS } from '@/lib/leads/types';
import { ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormError } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const SEARCH_SOURCES = ['APIFY_GOOGLE_MAPS', 'EXPLORIUM_BUSINESS_SEARCH', 'CAMOFOX_GOOGLE_SEARCH'] as const;

function percent(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '—';
}

function Indicator({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums text-foreground">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function CreateCampaignDialog({ organizationId, open, onClose }: { organizationId: string; open: boolean; onClose: () => void }) {
  const create = useCreateCampaign(organizationId);
  const [segment, setSegment] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [name, setName] = useState('');
  const [sources, setSources] = useState<string[]>(['APIFY_GOOGLE_MAPS']);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await create.mutateAsync({ segment, city, state, name: name.trim() || undefined, sources });
    setSegment('');
    setCity('');
    setState('');
    setName('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_80px]">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Segmento
              <Input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="Metalúrgicas" required />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Cidade
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Presidente Prudente" required />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              UF
              <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="SP" required />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Nome (opcional)
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Segmento — Cidade/UF" />
          </label>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">Buscas recorrentes</legend>
            {SEARCH_SOURCES.map((source) => (
              <label key={source} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sources.includes(source)}
                  onChange={(e) =>
                    setSources((current) => (e.target.checked ? [...current, source] : current.filter((s) => s !== source)))
                  }
                />
                {SCRAPE_SOURCE_LABELS[source]}
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Horário, metas e canais do Harvey são copiados da campanha mais recente; ajuste depois em Revenue Engine → Harvey.
          </p>
          {create.isError && <FormError message={(create.error as ApiError).message} />}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Criando…' : 'Criar campanha'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CampaignRow({ organizationId, campaign }: { organizationId: string; campaign: CampaignWithStats }) {
  const { stats } = campaign;
  const kindLabel = CAMPAIGN_KIND_LABELS[campaign.kind];
  return (
    <TableRow>
      <TableCell className="max-w-[320px]">
        <Link
          href={`/organizations/${organizationId}/campaigns/${campaign.id}`}
          className="font-medium text-foreground hover:underline"
        >
          {campaign.name}
        </Link>
        <div className="text-xs text-muted-foreground">
          {campaign.kind === 'STANDARD' ? `${campaign.segment} · ${campaign.city}/${campaign.state}` : kindLabel}
        </div>
      </TableCell>
      <TableCell>
        <Badge value={campaign.status} label={CAMPAIGN_STATUS_LABELS[campaign.status]} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {new Date(campaign.createdAt).toLocaleDateString('pt-BR')}
      </TableCell>
      <TableCell className="text-right tabular-nums">{stats.leadsFound}</TableCell>
      <TableCell className="text-right tabular-nums">
        {stats.qualified}
        <span className="ml-1 text-xs text-muted-foreground">{percent(stats.qualified, stats.leadsFound)}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{stats.disqualified}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{stats.pending}</TableCell>
      <TableCell className="text-right tabular-nums">{stats.messagesApproved}</TableCell>
      <TableCell className="text-right tabular-nums">{stats.messagesSent}</TableCell>
      <TableCell className="text-right tabular-nums">
        {stats.messagesReplied}
        <span className="ml-1 text-xs text-muted-foreground">{percent(stats.messagesReplied, stats.messagesSent)}</span>
      </TableCell>
    </TableRow>
  );
}

export default function CampaignsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canManage = membership ? (HARVEY_CONTROL_ROLES as readonly string[]).includes(membership.role) : false;
  const [filter, setFilter] = useState<CampaignOverviewFilter>({ page: 1 });
  const [creating, setCreating] = useState(false);
  const overview = useCampaignOverview(organizationId, filter);
  const update = (patch: Partial<CampaignOverviewFilter>) => setFilter((current) => ({ ...current, ...patch, page: 1 }));
  const totals = overview.data?.totals;
  const pages = overview.data ? Math.max(1, Math.ceil(overview.data.total / overview.data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-label text-accent-500">Prospecção</p>
          <h1 className="text-h1">Campanhas</h1>
        </div>
        {canManage && <Button onClick={() => setCreating(true)}>Nova campanha</Button>}
      </header>

      {totals && (
        <div className="grid grid-cols-2 divide-x divide-y divide-border rounded-lg border border-border bg-card sm:grid-cols-5 sm:divide-y-0">
          <Indicator label="Campanhas" value={totals.campaigns} hint={`${totals.activeCampaigns} ativas`} />
          <Indicator label="Empresas encontradas" value={totals.leads} />
          <Indicator label="Qualificadas" value={totals.qualified} hint={percent(totals.qualified, totals.leads)} />
          <Indicator label="Mensagens enviadas" value={totals.messagesSent} />
          <Indicator label="Respostas" value={totals.messagesReplied} hint={percent(totals.messagesReplied, totals.messagesSent)} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          className="w-56"
          placeholder="Buscar campanha"
          value={filter.search ?? ''}
          onChange={(e) => update({ search: e.target.value })}
        />
        <Input className="w-44" placeholder="Cidade" value={filter.city ?? ''} onChange={(e) => update({ city: e.target.value })} />
        <Input
          className="w-44"
          placeholder="Segmento"
          value={filter.segment ?? ''}
          onChange={(e) => update({ segment: e.target.value })}
        />
        <Select
          className="w-44"
          value={filter.status ?? ''}
          onChange={(e) => update({ status: (e.target.value || undefined) as CampaignStatus | undefined })}
        >
          <option value="">Ativas, pausadas e finalizadas</option>
          {(Object.keys(CAMPAIGN_STATUS_LABELS) as CampaignStatus[]).map((status) => (
            <option key={status} value={status}>
              {CAMPAIGN_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      {overview.isLoading && <Skeleton className="h-64 w-full" />}
      {overview.isError && <FormError message={(overview.error as ApiError).message} />}
      {overview.data && overview.data.items.length === 0 && (
        <p className="text-muted-foreground">Nenhuma campanha encontrada com esses filtros.</p>
      )}
      {overview.data && overview.data.items.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Campanha</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criada</TableHead>
                <TableHead className="text-right">Encontrados</TableHead>
                <TableHead className="text-right">Qualificados</TableHead>
                <TableHead className="text-right">Desqualif.</TableHead>
                <TableHead className="text-right">Pendentes</TableHead>
                <TableHead className="text-right">Aprovadas</TableHead>
                <TableHead className="text-right">Enviadas</TableHead>
                <TableHead className="text-right">Respostas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.data.items.map((campaign) => (
                <CampaignRow key={campaign.id} organizationId={organizationId} campaign={campaign} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {overview.data && pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <Button
            variant="secondary"
            disabled={(filter.page ?? 1) <= 1}
            onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
          >
            Anterior
          </Button>
          <span>
            Página {filter.page ?? 1} de {pages}
          </span>
          <Button
            variant="secondary"
            disabled={(filter.page ?? 1) >= pages}
            onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
          >
            Próxima
          </Button>
        </div>
      )}

      <CreateCampaignDialog organizationId={organizationId} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
