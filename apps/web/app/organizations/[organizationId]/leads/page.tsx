'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useLeads } from '@/lib/leads/use-leads';
import { useCreateScrapeJob, useScrapeJobs } from '@/lib/leads/use-scrape-jobs';
import { SCRAPE_SOURCE_LABELS, WRITE_ROLES, type LeadStatus, type ScrapeSourceType } from '@/lib/leads/types';
import { ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { LeadScoreBar } from '@/components/leads/lead-score-bar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Estilo local (não vira componente compartilhado — Task 7 não previu
// Input/Select/Button dark, só os componentes shadcn CSS-var-based e o
// LeadScoreBar). Reaproveitado nos 3 arquivos de página desta feature.
const fieldClass =
  'w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30';
const primaryButtonClass =
  'inline-flex items-center justify-center rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-md border border-ink-700 px-4 py-2 text-sm font-medium text-ink-50 transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';

const LEAD_STATUS_OPTIONS: Array<{ value: LeadStatus | ''; label: string }> = [
  { value: '', label: 'Todos os status' },
  { value: 'DISCOVERED', label: 'Descoberto' },
  { value: 'QUALIFIED', label: 'Qualificado' },
  { value: 'DISQUALIFIED', label: 'Desqualificado' },
  { value: 'OUTREACH_DRAFTED', label: 'Rascunho de contato' },
  { value: 'OUTREACH_APPROVED', label: 'Contato aprovado' },
  { value: 'CONTACTED', label: 'Contatado' },
  { value: 'REPLIED', label: 'Respondeu' },
  { value: 'CONVERTED', label: 'Convertido' },
  { value: 'LOST', label: 'Perdido' },
];

const SOURCE_TYPE_OPTIONS: Array<{ value: ScrapeSourceType | ''; label: string }> = [
  { value: '', label: 'Todas as fontes' },
  { value: 'APIFY_GOOGLE_MAPS', label: SCRAPE_SOURCE_LABELS.APIFY_GOOGLE_MAPS },
  { value: 'EXPLORIUM_BUSINESS_SEARCH', label: SCRAPE_SOURCE_LABELS.EXPLORIUM_BUSINESS_SEARCH },
  { value: 'CAMOFOX_GOOGLE_SEARCH', label: SCRAPE_SOURCE_LABELS.CAMOFOX_GOOGLE_SEARCH },
  { value: 'CAMOFOX_REDDIT_SEARCH', label: SCRAPE_SOURCE_LABELS.CAMOFOX_REDDIT_SEARCH },
  { value: 'MANUAL', label: SCRAPE_SOURCE_LABELS.MANUAL },
];

// Só as 4 fontes automatizáveis entram no formulário de "Nova busca" — MANUAL
// nunca é uma opção aqui (mesma regra de create-scrape-job.dto.ts).
const createScrapeJobSchema = z.object({
  sourceType: z.enum(['APIFY_GOOGLE_MAPS', 'EXPLORIUM_BUSINESS_SEARCH', 'CAMOFOX_GOOGLE_SEARCH', 'CAMOFOX_REDDIT_SEARCH']),
  city: z.string().min(1, 'Informe a cidade').max(120),
  state: z.string().min(1, 'Informe o estado').max(60),
  businessType: z.string().min(1, 'Informe o tipo de negócio').max(120),
  onlyWithoutWebsite: z.boolean().optional(),
  // Sem `.optional()`: o campo sempre carrega um valor (default 50 via
  // `defaultValues` do form) — evita o caso de borda de `z.coerce.number()`
  // sobre string vazia (`Number('') === 0`, que falharia `min(1)` mesmo o
  // limite sendo opcional no DTO do backend) e o mismatch de tipos que
  // `z.preprocess` introduz no genérico do `zodResolver`.
  limit: z.coerce.number().int().min(1, 'Mínimo 1').max(200, 'Máximo 200'),
});
type CreateScrapeJobFormValues = z.infer<typeof createScrapeJobSchema>;

function WebsiteBadge({ website }: { website: string | null }) {
  if (!website) {
    return (
      <span className="inline-block whitespace-nowrap rounded-full border border-accent-500/40 bg-accent-500/10 px-2 py-0.5 text-xs font-medium text-accent-400">
        Sem site
      </span>
    );
  }
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-ink-800 px-2 py-0.5 text-xs font-medium text-ink-500">
      Com site
    </span>
  );
}

function ScrapeJobsPanel({ organizationId }: { organizationId: string }) {
  const [expanded, setExpanded] = useState(false);
  const scrapeJobs = useScrapeJobs(organizationId);

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-ink-50"
        aria-expanded={expanded}
      >
        <span>Buscas recentes {scrapeJobs.data ? `(${scrapeJobs.data.length})` : ''}</span>
        <span className="text-ink-500">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="border-t border-ink-700 px-4 py-3">
          {scrapeJobs.isLoading && <p className="text-sm text-ink-500">Carregando buscas…</p>}
          {scrapeJobs.isSuccess && scrapeJobs.data.length === 0 && (
            <p className="text-sm text-ink-500">Nenhuma busca disparada ainda.</p>
          )}
          <ul className="flex flex-col gap-2">
            {scrapeJobs.data?.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="text-ink-50">
                    {SCRAPE_SOURCE_LABELS[job.sourceType]} — {job.businessType} em {job.city}/{job.state}
                  </span>
                  <span className="text-xs text-ink-500">
                    {job.leadsFound} lead{job.leadsFound === 1 ? '' : 's'} encontrado
                    {job.leadsFound === 1 ? '' : 's'} · {new Date(job.createdAt).toLocaleString('pt-BR')}
                    {job.errorMessage ? ` · ${job.errorMessage}` : ''}
                  </span>
                </div>
                <Badge value={job.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;

  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [sourceType, setSourceType] = useState<ScrapeSourceType | ''>('');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [hasWebsite, setHasWebsite] = useState<'' | 'true' | 'false'>('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const leads = useLeads(organizationId, {
    city: city || undefined,
    state: state || undefined,
    sourceType: sourceType || undefined,
    status: status || undefined,
    hasWebsite: hasWebsite === '' ? undefined : hasWebsite === 'true',
  });
  const createScrapeJob = useCreateScrapeJob(organizationId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateScrapeJobFormValues>({
    resolver: zodResolver(createScrapeJobSchema),
    defaultValues: { onlyWithoutWebsite: true, limit: 50 },
  });

  const onSubmit = handleSubmit((values) => {
    createScrapeJob.mutate(values, { onSuccess: () => { reset(); setDialogOpen(false); } });
  });

  return (
    // `dark` escopado aqui (não em app/organizations/[organizationId]/layout.tsx)
    // — layout.tsx renderiza AppHeader/AppNav como irmãos ANTES de `{children}`,
    // então esta div (a raiz do que a página retorna) nunca alcança os
    // componentes compartilhados; `-mx-4 -my-10 px-4 py-10` cancela o
    // padding do `<main>` do layout para o fundo escuro preencher até a
    // borda do container em vez de sobrar uma faixa clara ao redor.
    <div className="dark -mx-4 -my-10 min-h-screen bg-ink-950 px-4 py-10 text-ink-50">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-ink-50">Leads</h1>
          {canWrite && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <button type="button" className={primaryButtonClass}>
                  + Nova busca
                </button>
              </DialogTrigger>
              {/* `className="dark"` direto no DialogContent: Radix faz portal
                  pro final do <body>, fora da árvore desta div — sem isso o
                  diálogo herdaria o tema claro do documento. */}
              <DialogContent className="dark border-ink-700 bg-ink-900 text-ink-50">
                <DialogHeader>
                  <DialogTitle>Nova busca de leads</DialogTitle>
                  <DialogDescription className="text-ink-500">
                    Dispara um `ScrapeJob` numa das fontes automatizáveis. O worker processa em segundo plano.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={onSubmit} className="flex flex-col gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-300">Fonte</label>
                    <select className={fieldClass} {...register('sourceType')}>
                      {SOURCE_TYPE_OPTIONS.filter((o) => o.value !== '' && o.value !== 'MANUAL').map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {errors.sourceType && <p className="mt-1 text-xs text-negative-500">{errors.sourceType.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-300">Cidade</label>
                      <input className={fieldClass} placeholder="São Paulo" {...register('city')} />
                      {errors.city && <p className="mt-1 text-xs text-negative-500">{errors.city.message}</p>}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-300">Estado</label>
                      <input className={fieldClass} placeholder="SP" {...register('state')} />
                      {errors.state && <p className="mt-1 text-xs text-negative-500">{errors.state.message}</p>}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-300">Tipo de negócio</label>
                    <input className={fieldClass} placeholder="restaurante, dentista, oficina…" {...register('businessType')} />
                    {errors.businessType && <p className="mt-1 text-xs text-negative-500">{errors.businessType.message}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-300">Limite de leads</label>
                      <input type="number" min={1} max={200} className={fieldClass} placeholder="50" {...register('limit')} />
                      {errors.limit && <p className="mt-1 text-xs text-negative-500">{errors.limit.message}</p>}
                    </div>
                    <label className="mt-6 flex items-center gap-2 text-sm text-ink-300">
                      <input type="checkbox" className="h-4 w-4 rounded border-ink-700 bg-ink-900" {...register('onlyWithoutWebsite')} />
                      Só negócios sem site
                    </label>
                  </div>
                  <FormErrorDark
                    message={createScrapeJob.isError ? (createScrapeJob.error as ApiError).message : null}
                  />
                  <DialogFooter>
                    <button type="submit" className={primaryButtonClass} disabled={createScrapeJob.isPending}>
                      {createScrapeJob.isPending ? 'Disparando…' : 'Disparar busca'}
                    </button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            placeholder="Cidade…"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={`${fieldClass} max-w-[160px]`}
          />
          <input
            placeholder="Estado…"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className={`${fieldClass} max-w-[120px]`}
          />
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value as ScrapeSourceType | '')} className={`${fieldClass} max-w-[220px]`}>
            {SOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | '')} className={`${fieldClass} max-w-[200px]`}>
            {LEAD_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={hasWebsite}
            onChange={(e) => setHasWebsite(e.target.value as '' | 'true' | 'false')}
            className={`${fieldClass} max-w-[160px]`}
          >
            <option value="">Com ou sem site</option>
            <option value="false">Sem site</option>
            <option value="true">Com site</option>
          </select>
        </div>

        {leads.isLoading && <p className="text-ink-500">Carregando leads…</p>}
        {leads.isSuccess && leads.data.length === 0 && <p className="text-ink-500">Nenhum lead encontrado.</p>}

        {leads.isSuccess && leads.data.length > 0 && (
          <div className="rounded-lg border border-ink-700 bg-ink-900">
            <Table>
              <TableHeader>
                <TableRow className="border-ink-700 hover:bg-transparent">
                  <TableHead className="text-ink-300">Nome</TableHead>
                  <TableHead className="text-ink-300">Cidade/Estado</TableHead>
                  <TableHead className="text-ink-300">Categoria</TableHead>
                  <TableHead className="text-ink-300">Site</TableHead>
                  <TableHead className="text-ink-300">Score</TableHead>
                  <TableHead className="text-ink-300">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.data.map((lead) => (
                  <TableRow key={lead.id} className="border-ink-700 hover:bg-ink-800">
                    <TableCell>
                      <Link href={`/organizations/${organizationId}/leads/${lead.id}`} className="font-medium text-ink-50 hover:text-accent-400">
                        {lead.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink-300">{[lead.city, lead.state].filter(Boolean).join('/') || '—'}</TableCell>
                    <TableCell className="text-ink-300">{lead.googleCategory ?? '—'}</TableCell>
                    <TableCell>
                      <WebsiteBadge website={lead.website} />
                    </TableCell>
                    <TableCell className="min-w-[160px]">
                      {lead.scoreBreakdown ? <LeadScoreBar breakdown={lead.scoreBreakdown} /> : <span className="text-xs text-ink-500">não pontuado</span>}
                    </TableCell>
                    <TableCell>
                      <Badge value={lead.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <ScrapeJobsPanel organizationId={organizationId} />
      </div>
    </div>
  );
}

// Equivalente dark de `FormError` (components/ui/card.tsx) — aquele é
// hardcoded pra fundo claro (`bg-red-50 text-red-700`), incompatível com o
// container escuro desta página.
function FormErrorDark({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="rounded-md border border-negative-500/30 bg-negative-500/10 px-3 py-2 text-sm text-negative-500">{message}</p>;
}
