'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { isSafeHttpUrl } from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useMarketOpportunities, useUpdateMarketOpportunityStatus } from '@/lib/market-opportunities/use-market-opportunities';
import {
  useCreateRedditWatchTopic,
  useRedditWatchTopics,
  useUpdateRedditWatchTopic,
} from '@/lib/market-opportunities/use-reddit-watch-topics';
import { WRITE_ROLES, type MarketOpportunity, type MarketOpportunityStatus } from '@/lib/market-opportunities/types';
import { ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormError } from '@/components/ui/card';

const STATUS_OPTIONS: Array<{ value: MarketOpportunityStatus | ''; label: string }> = [
  { value: 'NEW', label: 'Novas (fila de revisão)' },
  { value: 'REVIEWING', label: 'Em revisão' },
  { value: 'PURSUING', label: 'Sendo perseguidas' },
  { value: 'DISMISSED', label: 'Descartadas' },
  { value: '', label: 'Todas' },
];

// Cartão de oportunidade — mesmo padrão visual de `QueueCard` da fila de
// Outreach (apps/web/app/organizations/[organizationId]/outreach/page.tsx):
// Badge de status + corpo + ações condicionadas ao status atual, cada botão
// disparando uma única mutation (`updateStatus`).
function OpportunityCard({
  opportunity,
  organizationId,
  canWrite,
}: {
  opportunity: MarketOpportunity;
  organizationId: string;
  canWrite: boolean;
}) {
  const updateStatus = useUpdateMarketOpportunityStatus(organizationId);
  const [quotesExpanded, setQuotesExpanded] = useState(false);

  function moveTo(status: MarketOpportunityStatus) {
    updateStatus.mutate({ opportunityId: opportunity.id, status });
  }

  // O backend não impõe uma máquina de transições estrita para `status`
  // (`updateStatus` aceita qualquer valor do enum, ver comentário de topo de
  // MarketOpportunitiesService) — a UI é quem modela o fluxo natural:
  // NEW é o único estado que oferece "Iniciar revisão"; NEW e REVIEWING
  // oferecem "Perseguir"/"Descartar"; PURSUING/DISMISSED são terminais aqui.
  // SEGURANÇA: `sourceUrls` é a IA ecoando URLs de posts raspados do Reddit —
  // conteúdo de terceiro, gravado pelo consumer de clustering. A ingestão já
  // descarta o que não for http/https, mas a checagem é repetida aqui, no
  // render, como defesa em profundidade (linhas gravadas antes desta correção
  // continuam no banco, e um `href="javascript:..."` é XSS armazenado). URL
  // insegura simplesmente não vira link.
  const safeSourceUrls = opportunity.sourceUrls.filter(isSafeHttpUrl);

  const showStartReview = opportunity.status === 'NEW';
  const showPursueOrDismiss = opportunity.status === 'NEW' || opportunity.status === 'REVIEWING';

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge value={opportunity.status} />
          <span className="text-xs text-muted-foreground">
            {opportunity.mentionCount} menç{opportunity.mentionCount === 1 ? 'ão' : 'ões'}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(opportunity.discoveredAt).toLocaleString('pt-BR')}
        </span>
      </div>

      <p className="mt-2 text-sm font-medium text-foreground">{opportunity.title}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{opportunity.problemDescription}</p>

      {opportunity.sampleQuotes.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setQuotesExpanded((v) => !v)}
            className="text-xs font-medium text-accent-400 hover:underline"
            aria-expanded={quotesExpanded}
          >
            {quotesExpanded ? 'Ocultar' : 'Ver'} citações de exemplo ({opportunity.sampleQuotes.length})
          </button>
          {quotesExpanded && (
            <ul className="mt-2 flex flex-col gap-2 border-l-2 border-border pl-3">
              {opportunity.sampleQuotes.map((quote, index) => (
                <li key={index} className="text-xs italic text-muted-foreground">
                  “{quote}”
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {safeSourceUrls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {safeSourceUrls.map((url, index) => (
            // `key` inclui o índice: `sourceUrls` vem da IA e pode repetir a
            // mesma URL no mesmo cluster — a URL sozinha não é chave única.
            <a
              key={`${url}-${index}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-accent-400 hover:underline"
            >
              Ver fonte →
            </a>
          ))}
        </div>
      )}

      {canWrite && (showStartReview || showPursueOrDismiss) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {showStartReview && (
            <Button size="sm" disabled={updateStatus.isPending} onClick={() => moveTo('REVIEWING')}>
              Iniciar revisão
            </Button>
          )}
          {showPursueOrDismiss && (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={updateStatus.isPending}
                onClick={() => moveTo('PURSUING')}
              >
                Perseguir
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="border border-negative-500/40 text-negative-500 hover:bg-negative-500/10"
                disabled={updateStatus.isPending}
                onClick={() => moveTo('DISMISSED')}
              >
                Descartar
              </Button>
            </>
          )}
        </div>
      )}
      <FormError message={updateStatus.isError ? (updateStatus.error as ApiError).message : null} />
    </li>
  );
}

// Painel colapsável de gestão de RedditWatchTopic — mesmo padrão de
// expand/collapse de `ScrapeJobsPanel` (leads/page.tsx), mas essa entidade é
// pequena o bastante pra caber list+criar+ativar/desativar aqui mesmo, sem
// página própria (ver brief da Task 14).
function RedditWatchTopicsPanel({ organizationId, canWrite }: { organizationId: string; canWrite: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const topics = useRedditWatchTopics(organizationId);
  const createTopic = useCreateRedditWatchTopic(organizationId);
  const updateTopic = useUpdateRedditWatchTopic(organizationId);

  const [query, setQuery] = useState('');
  const [subreddit, setSubreddit] = useState('');

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    createTopic.mutate(
      { query: query.trim(), subreddit: subreddit.trim() || undefined },
      { onSuccess: () => { setQuery(''); setSubreddit(''); } },
    );
  }

  function toggleActive(topicId: string, isActive: boolean) {
    updateTopic.mutate({ topicId, input: { isActive: !isActive } });
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-foreground"
        aria-expanded={expanded}
      >
        <span>Tópicos monitorados no Reddit {topics.data ? `(${topics.data.length})` : ''}</span>
        <span className="text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-4 border-t border-border px-4 py-3">
          {canWrite && (
            <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Termo de busca</label>
                <Input
                  placeholder="ex.: 'problema com agendamento'"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="max-w-[240px]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Subreddit (opcional)</label>
                <Input
                  placeholder="ex.: smallbusiness"
                  value={subreddit}
                  onChange={(e) => setSubreddit(e.target.value)}
                  className="max-w-[180px]"
                />
              </div>
              <Button type="submit" size="sm" disabled={createTopic.isPending || !query.trim()}>
                + Adicionar tópico
              </Button>
            </form>
          )}
          <FormError message={createTopic.isError ? (createTopic.error as ApiError).message : null} />
          <FormError message={updateTopic.isError ? (updateTopic.error as ApiError).message : null} />

          {topics.isLoading && <p className="text-sm text-muted-foreground">Carregando tópicos…</p>}
          {topics.isSuccess && topics.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum tópico monitorado ainda.</p>
          )}
          <ul className="flex flex-col gap-2">
            {topics.data?.map((topic) => (
              <li
                key={topic.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="text-foreground">
                    {topic.query}
                    {topic.subreddit ? ` · r/${topic.subreddit}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Criado em {new Date(topic.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge value={topic.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={updateTopic.isPending}
                      onClick={() => toggleActive(topic.id, topic.isActive)}
                    >
                      {topic.isActive ? 'Desativar' : 'Ativar'}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function MarketOpportunitiesPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;

  // Default NEW (fila de revisão) — mesmo racional do default DRAFT de
  // outreach/page.tsx: a tela abre já mostrando o que precisa de decisão
  // humana.
  const [status, setStatus] = useState<MarketOpportunityStatus | ''>('NEW');
  const opportunities = useMarketOpportunities(organizationId, { status: status || undefined });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Oportunidades de mercado</h1>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as MarketOpportunityStatus | '')}
          className="max-w-[280px]"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>

      {opportunities.isLoading && <p className="text-muted-foreground">Carregando oportunidades…</p>}
      {opportunities.isSuccess && opportunities.data.length === 0 && (
        <p className="text-muted-foreground">Nenhuma oportunidade de mercado nesse status.</p>
      )}

      {opportunities.isSuccess && opportunities.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {opportunities.data.map((opportunity) => (
            <OpportunityCard
              key={opportunity.id}
              opportunity={opportunity}
              organizationId={organizationId}
              canWrite={canWrite}
            />
          ))}
        </ul>
      )}

      <RedditWatchTopicsPanel organizationId={organizationId} canWrite={canWrite} />
    </div>
  );
}
