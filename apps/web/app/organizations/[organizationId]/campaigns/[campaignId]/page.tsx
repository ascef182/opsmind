'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { isSafeHttpUrl } from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import {
  useCampaignAction,
  useCampaignDetail,
  useCampaignLeads,
  useCampaignMessages,
  useDuplicateCandidates,
  useRenameCampaign,
  useReviewDuplicate,
} from '@/lib/campaigns/use-campaigns';
import {
  ACTION_LABELS,
  ACTIONS_BY_STATUS,
  CAMPAIGN_KIND_LABELS,
  CAMPAIGN_STATUS_LABELS,
  CREATION_SOURCE_LABELS,
  DISQUALIFICATION_LABELS,
  DUPLICATE_REASON_LABELS,
  ENTITY_TYPE_LABELS,
  ORIGIN_LABELS,
  type CampaignAction,
  type CampaignLeadsFilter,
  type DuplicateLeadSummary,
  type LeadEntityType,
} from '@/lib/campaigns/types';
import { HARVEY_CONTROL_ROLES } from '@/lib/harvey/types';
import { WRITE_ROLES } from '@/lib/leads/types';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormError } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const LEAD_STATUS_LABELS: Record<string, string> = {
  DISCOVERED: 'Pendente',
  QUALIFIED: 'Qualificado',
  DISQUALIFIED: 'Desqualificado',
  OUTREACH_DRAFTED: 'Rascunho',
  OUTREACH_APPROVED: 'Aprovado',
  CONTACTED: 'Contatado',
  REPLIED: 'Respondeu',
  CONVERTED: 'Convertido',
  LOST: 'Perdido',
};

const OUTREACH_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Aguardando aprovação',
  APPROVED: 'Aprovada',
  SENDING: 'Enviando',
  SEND_UNKNOWN: 'Envio sem confirmação',
  SENT: 'Enviada',
  REPLIED: 'Respondida',
  REJECTED: 'Rejeitada',
};

const MESSAGE_FILTERS = ['DRAFT', 'APPROVED', 'SENT', 'REPLIED', 'REJECTED'] as const;

type Tab = 'leads' | 'messages' | 'duplicates';

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('pt-BR') : '—';
}

function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </Button>
      <span>
        Página {page} de {pages} · {total} no total
      </span>
      <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Próxima
      </Button>
    </div>
  );
}

function LeadsTab({ organizationId, campaignId }: { organizationId: string; campaignId: string }) {
  const [filter, setFilter] = useState<CampaignLeadsFilter>({ page: 1, sort: 'score', order: 'desc' });
  const leads = useCampaignLeads(organizationId, campaignId, filter);
  const update = (patch: Partial<CampaignLeadsFilter>) => setFilter((current) => ({ ...current, ...patch, page: 1 }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Input
          className="w-56"
          placeholder="Empresa, categoria ou telefone"
          value={filter.search ?? ''}
          onChange={(e) => update({ search: e.target.value })}
        />
        <Select
          className="w-44"
          value={filter.qualification ?? ''}
          onChange={(e) => update({ qualification: (e.target.value || undefined) as CampaignLeadsFilter['qualification'] })}
        >
          <option value="">Toda qualificação</option>
          <option value="qualified">Qualificados</option>
          <option value="disqualified">Desqualificados</option>
          <option value="pending">Pendentes</option>
        </Select>
        <Select
          className="w-44"
          value={filter.entityType ?? ''}
          onChange={(e) => update({ entityType: (e.target.value || undefined) as LeadEntityType | undefined })}
        >
          <option value="">Todo tipo</option>
          {(Object.keys(ENTITY_TYPE_LABELS) as LeadEntityType[]).map((type) => (
            <option key={type} value={type}>
              {ENTITY_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
        <Select
          className="w-52"
          value={`${filter.sort}:${filter.order}`}
          onChange={(e) => {
            const [sort, order] = e.target.value.split(':') as [CampaignLeadsFilter['sort'], CampaignLeadsFilter['order']];
            update({ sort, order });
          }}
        >
          <option value="score:desc">Maior pontuação</option>
          <option value="discoveredAt:desc">Descobertos recentemente</option>
          <option value="lastFoundAt:desc">Vistos recentemente</option>
          <option value="name:asc">Nome (A–Z)</option>
        </Select>
      </div>

      {leads.isLoading && <Skeleton className="h-64 w-full" />}
      {leads.isError && <FormError message={(leads.error as ApiError).message} />}
      {leads.data && leads.data.items.length === 0 && <p className="text-muted-foreground">Nenhum lead com esses filtros.</p>}
      {leads.data && leads.data.items.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Empresa</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Site</TableHead>
                <TableHead className="text-right">Pontuação</TableHead>
                <TableHead>Qualificação</TableHead>
                <TableHead>Abordagem</TableHead>
                <TableHead>Descoberta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.data.items.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="max-w-[260px]">
                    <Link
                      href={`/organizations/${organizationId}/leads/${lead.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {lead.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {ENTITY_TYPE_LABELS[lead.entityType]}
                      {lead.duplicateOfLeadId && ' · duplicata'}
                      {lead.participation.origin === 'LEGACY' && ` · ${ORIGIN_LABELS.LEGACY.toLowerCase()}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{lead.googleCategory ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {lead.city ? `${lead.city}${lead.state ? `/${lead.state}` : ''}` : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{lead.phone ?? lead.whatsapp ?? '—'}</TableCell>
                  <TableCell className="max-w-[180px] truncate text-muted-foreground">
                    {lead.website && isSafeHttpUrl(lead.website) ? (
                      <a href={lead.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {lead.website.replace(/^https?:\/\/(www\.)?/, '')}
                      </a>
                    ) : (
                      (lead.website ?? '—')
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{lead.score ?? '—'}</TableCell>
                  <TableCell>
                    <Badge value={lead.status} label={LEAD_STATUS_LABELS[lead.status] ?? lead.status} />
                    {lead.disqualificationReason && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {DISQUALIFICATION_LABELS[lead.disqualificationReason] ?? lead.disqualificationReason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {lead.latestOutreachStatus ? OUTREACH_STATUS_LABELS[lead.latestOutreachStatus] : '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(lead.discoveredAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {leads.data && (
        <Pager
          page={leads.data.page}
          total={leads.data.total}
          pageSize={leads.data.pageSize}
          onPage={(page) => setFilter((f) => ({ ...f, page }))}
        />
      )}
    </div>
  );
}

function MessagesTab({ organizationId, campaignId }: { organizationId: string; campaignId: string }) {
  const [status, setStatus] = useState<string>('DRAFT');
  const [page, setPage] = useState(1);
  const messages = useCampaignMessages(organizationId, campaignId, status, page);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {MESSAGE_FILTERS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={status === value ? 'primary' : 'secondary'}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
          >
            {OUTREACH_STATUS_LABELS[value]}
          </Button>
        ))}
      </div>
      {messages.isLoading && <Skeleton className="h-40 w-full" />}
      {messages.isError && <FormError message={(messages.error as ApiError).message} />}
      {messages.data && messages.data.items.length === 0 && (
        <p className="text-muted-foreground">Nenhuma mensagem com esse status nesta campanha.</p>
      )}
      <ul className="flex flex-col gap-2">
        {messages.data?.items.map((message) => (
          <li key={message.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Link
                href={`/organizations/${organizationId}/leads/${message.lead.id}`}
                className="font-medium text-foreground hover:underline"
              >
                {message.lead.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {message.channel} · criada em {formatDate(message.createdAt)}
                {message.sentAt && ` · enviada em ${formatDate(message.sentAt)}`}
                {message.repliedAt && ` · respondida em ${formatDate(message.repliedAt)}`}
              </span>
            </div>
            {message.subject && <p className="mt-1 text-sm font-medium">{message.subject}</p>}
            <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">{message.body}</p>
            {message.rejectedReason && <p className="mt-1 text-xs text-negative-500">Motivo: {message.rejectedReason}</p>}
          </li>
        ))}
      </ul>
      {messages.data && (
        <Pager page={messages.data.page} total={messages.data.total} pageSize={messages.data.pageSize} onPage={setPage} />
      )}
      <p className="text-xs text-muted-foreground">
        Para aprovar ou rejeitar, use a fila de <Link href={`/organizations/${organizationId}/outreach`} className="underline">Aprovações</Link>{' '}
        ou o detalhe do lead.
      </p>
    </div>
  );
}

function DuplicateSide({ organizationId, lead }: { organizationId: string; lead: DuplicateLeadSummary }) {
  return (
    <div className="min-w-0 flex-1 text-sm">
      <Link href={`/organizations/${organizationId}/leads/${lead.id}`} className="font-medium text-foreground hover:underline">
        {lead.name}
      </Link>
      <div className="text-xs text-muted-foreground">
        {[lead.city, lead.phone, lead.website?.replace(/^https?:\/\/(www\.)?/, '')].filter(Boolean).join(' · ') || '—'}
      </div>
      <div className="text-xs text-muted-foreground">
        {LEAD_STATUS_LABELS[lead.status] ?? lead.status} · {lead._count.outreachMessages} mensagem(ns) · desde{' '}
        {formatDate(lead.discoveredAt)}
      </div>
    </div>
  );
}

function DuplicatesTab({ organizationId, campaignId, canWrite }: { organizationId: string; campaignId: string; canWrite: boolean }) {
  const candidates = useDuplicateCandidates(organizationId, campaignId);
  const review = useReviewDuplicate(organizationId);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Pares com o mesmo site ou o mesmo telefone na mesma cidade. Nada é fundido: confirmar só marca qual registro é a duplicata
        e o tira do trabalho automático. Pode ser desfeito.
      </p>
      {candidates.isLoading && <Skeleton className="h-32 w-full" />}
      {candidates.isError && <FormError message={(candidates.error as ApiError).message} />}
      {review.isError && <FormError message={(review.error as ApiError).message} />}
      {candidates.data && candidates.data.length === 0 && <p className="text-muted-foreground">Nenhuma possível duplicata pendente.</p>}
      <ul className="flex flex-col gap-2">
        {candidates.data?.map((candidate) => (
          <li key={candidate.id} className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 text-xs text-muted-foreground">
              {candidate.reasons.map((reason) => DUPLICATE_REASON_LABELS[reason]).join(' e ')}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <DuplicateSide organizationId={organizationId} lead={candidate.leadA} />
              <DuplicateSide organizationId={organizationId} lead={candidate.leadB} />
            </div>
            {canWrite && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ candidateId: candidate.id, decision: 'confirm', duplicateLeadId: candidate.leadB.id })}
                >
                  “{candidate.leadB.name}” é duplicata
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ candidateId: candidate.id, decision: 'confirm', duplicateLeadId: candidate.leadA.id })}
                >
                  “{candidate.leadA.name}” é duplicata
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ candidateId: candidate.id, decision: 'dismiss' })}
                >
                  São empresas diferentes
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CampaignDetailPage() {
  const { organizationId, campaignId } = useParams<{ organizationId: string; campaignId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canManage = membership ? (HARVEY_CONTROL_ROLES as readonly string[]).includes(membership.role) : false;
  const canWrite = membership ? (WRITE_ROLES as readonly string[]).includes(membership.role) : false;
  const campaign = useCampaignDetail(organizationId, campaignId);
  const action = useCampaignAction(organizationId, campaignId);
  const rename = useRenameCampaign(organizationId, campaignId);
  const [tab, setTab] = useState<Tab>('leads');
  const [editingName, setEditingName] = useState<string | null>(null);

  if (campaign.isLoading) return <Skeleton className="h-96 w-full" />;
  if (campaign.isError) return <FormError message={(campaign.error as ApiError).message} />;
  if (!campaign.data) return null;
  const data = campaign.data;
  const { stats } = data;
  const actions: CampaignAction[] = data.kind === 'STANDARD' ? ACTIONS_BY_STATUS[data.status] : [];

  const runAction = (next: CampaignAction) => {
    if (next === 'archive' && !window.confirm('Arquivar esta campanha? Ela some da lista padrão; leads e mensagens continuam.')) return;
    action.mutate(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href={`/organizations/${organizationId}/campaigns`} className="text-sm text-muted-foreground hover:text-foreground">
          ← Campanhas
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            {editingName === null ? (
              <h1 className="text-h1">{data.name}</h1>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename.mutate(editingName, { onSuccess: () => setEditingName(null) });
                }}
              >
                <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} className="w-80" autoFocus />
                <Button type="submit" size="sm" disabled={rename.isPending}>
                  Salvar
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingName(null)}>
                  Cancelar
                </Button>
              </form>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge value={data.status} label={CAMPAIGN_STATUS_LABELS[data.status]} />
              {data.kind === 'STANDARD' ? (
                <span>
                  {data.segment} · {data.city}/{data.state}
                </span>
              ) : (
                <span>{CAMPAIGN_KIND_LABELS[data.kind]}</span>
              )}
              <span>· criada em {formatDate(data.createdAt)}</span>
              <span>· {CREATION_SOURCE_LABELS[data.creationSource]}</span>
              {data.kind === 'STANDARD' && <span>· {data.targetCount} busca(s) recorrente(s)</span>}
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {editingName === null && (
                <Button variant="ghost" size="sm" onClick={() => setEditingName(data.name)}>
                  Renomear
                </Button>
              )}
              {actions.map((next) => (
                <Button key={next} variant="secondary" size="sm" disabled={action.isPending} onClick={() => runAction(next)}>
                  {ACTION_LABELS[next]}
                </Button>
              ))}
            </div>
          )}
        </div>
        {data.kind === 'LEGACY' && (
          <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
            Leads antigos cuja busca de origem não pôde ser comprovada. Os dados foram preservados; o Harvey não trabalha neles
            automaticamente.
          </p>
        )}
        {action.isError && <FormError message={(action.error as ApiError).message} />}
        {rename.isError && <FormError message={(rename.error as ApiError).message} />}
      </header>

      <div className="grid grid-cols-2 divide-x divide-y divide-border rounded-lg border border-border bg-card sm:grid-cols-4 lg:grid-cols-7 lg:divide-y-0">
        {[
          ['Encontrados', stats.leadsFound],
          ['Qualificados', stats.qualified],
          ['Desqualificados', stats.disqualified],
          ['Pendentes', stats.pending],
          ['Aprovadas', stats.messagesApproved],
          ['Enviadas', stats.messagesSent],
          ['Respostas', stats.messagesReplied],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 px-4 py-3">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-xl font-semibold tabular-nums">{value}</span>
          </div>
        ))}
      </div>

      <nav className="flex gap-1 border-b border-border" aria-label="Seções da campanha">
        {(
          [
            ['leads', 'Leads'],
            ['messages', `Mensagens${stats.messagesPendingApproval ? ` (${stats.messagesPendingApproval} pendentes)` : ''}`],
            ['duplicates', 'Possíveis duplicatas'],
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            aria-current={tab === value ? 'page' : undefined}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              tab === value ? 'border-accent-500 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'leads' && <LeadsTab organizationId={organizationId} campaignId={campaignId} />}
      {tab === 'messages' && <MessagesTab organizationId={organizationId} campaignId={campaignId} />}
      {tab === 'duplicates' && <DuplicatesTab organizationId={organizationId} campaignId={campaignId} canWrite={canWrite} />}
    </div>
  );
}
