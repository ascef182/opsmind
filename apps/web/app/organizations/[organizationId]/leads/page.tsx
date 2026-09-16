'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MessageCircle } from 'lucide-react';
import { useCurrentMembership, useMembers } from '@/lib/memberships/use-memberships';
import { useLeads } from '@/lib/leads/use-leads';
import { useCreateScrapeJob, useScrapeJobs } from '@/lib/leads/use-scrape-jobs';
import { SCRAPE_SOURCE_LABELS, WRITE_ROLES, type LeadStatus, type ScrapeSourceType } from '@/lib/leads/types';
import { ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormError } from '@/components/ui/card';
import { LeadScoreBar } from '@/components/leads/lead-score-bar';
import { SocialBadges } from '@/components/leads/social-badges';
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
    <span className="inline-block whitespace-nowrap rounded-full bg-ink-800 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Com site
    </span>
  );
}

function ScrapeJobsPanel({ organizationId }: { organizationId: string }) {
  const [expanded, setExpanded] = useState(false);
  const scrapeJobs = useScrapeJobs(organizationId);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-foreground"
        aria-expanded={expanded}
      >
        <span>Buscas recentes {scrapeJobs.data ? `(${scrapeJobs.data.length})` : ''}</span>
        <span className="text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {scrapeJobs.isLoading && <p className="text-sm text-muted-foreground">Carregando buscas…</p>}
          {scrapeJobs.isSuccess && scrapeJobs.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma busca disparada ainda.</p>
          )}
          <ul className="flex flex-col gap-2">
            {scrapeJobs.data?.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="text-foreground">
                    {SCRAPE_SOURCE_LABELS[job.sourceType]} — {job.businessType} em {job.city}/{job.state}
                  </span>
                  <span className="text-xs text-muted-foreground">
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
  const members = useMembers(organizationId);

  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [sourceType, setSourceType] = useState<ScrapeSourceType | ''>('');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [hasWebsite, setHasWebsite] = useState<'' | 'true' | 'false'>('');
  const [hasContactMethod, setHasContactMethod] = useState<'' | 'true' | 'false'>('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const leads = useLeads(organizationId, {
    city: city || undefined,
    state: state || undefined,
    sourceType: sourceType || undefined,
    status: status || undefined,
    hasWebsite: hasWebsite === '' ? undefined : hasWebsite === 'true',
    hasContactMethod: hasContactMethod === '' ? undefined : hasContactMethod === 'true',
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Leads</h1>
        {canWrite && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>+ Nova busca</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova busca de leads</DialogTitle>
                <DialogDescription>
                  Dispara um `ScrapeJob` numa das fontes automatizáveis. O worker processa em segundo plano.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Fonte</label>
                  <Select {...register('sourceType')}>
                    {SOURCE_TYPE_OPTIONS.filter((o) => o.value !== '' && o.value !== 'MANUAL').map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  {errors.sourceType && <p className="mt-1 text-xs text-negative-500">{errors.sourceType.message}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Cidade</label>
                    <Input placeholder="São Paulo" {...register('city')} />
                    {errors.city && <p className="mt-1 text-xs text-negative-500">{errors.city.message}</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Estado</label>
                    <Input placeholder="SP" {...register('state')} />
                    {errors.state && <p className="mt-1 text-xs text-negative-500">{errors.state.message}</p>}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo de negócio</label>
                  <Input placeholder="restaurante, dentista, oficina…" {...register('businessType')} />
                  {errors.businessType && <p className="mt-1 text-xs text-negative-500">{errors.businessType.message}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Limite de leads</label>
                    <Input type="number" min={1} max={200} placeholder="50" {...register('limit')} />
                    {errors.limit && <p className="mt-1 text-xs text-negative-500">{errors.limit.message}</p>}
                  </div>
                  <label className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" className="h-4 w-4 rounded border-input bg-input/30" {...register('onlyWithoutWebsite')} />
                    Só negócios sem site
                  </label>
                </div>
                <FormError message={createScrapeJob.isError ? (createScrapeJob.error as ApiError).message : null} />
                <DialogFooter>
                  <Button type="submit" disabled={createScrapeJob.isPending}>
                    {createScrapeJob.isPending ? 'Disparando…' : 'Disparar busca'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Cidade…" value={city} onChange={(e) => setCity(e.target.value)} className="max-w-[160px]" />
        <Input placeholder="Estado…" value={state} onChange={(e) => setState(e.target.value)} className="max-w-[120px]" />
        <Select
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value as ScrapeSourceType | '')}
          className="max-w-[220px]"
        >
          {SOURCE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | '')} className="max-w-[200px]">
          {LEAD_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          value={hasWebsite}
          onChange={(e) => setHasWebsite(e.target.value as '' | 'true' | 'false')}
          className="max-w-[160px]"
        >
          <option value="">Com ou sem site</option>
          <option value="false">Sem site</option>
          <option value="true">Com site</option>
        </Select>
        <Select
          value={hasContactMethod}
          onChange={(e) => setHasContactMethod(e.target.value as '' | 'true' | 'false')}
          className="max-w-[200px]"
        >
          <option value="">Com ou sem contato</option>
          <option value="true">Com contato</option>
          <option value="false">Sem contato</option>
        </Select>
      </div>

      {leads.isLoading && <p className="text-muted-foreground">Carregando leads…</p>}
      {leads.isSuccess && leads.data.length === 0 && <p className="text-muted-foreground">Nenhum lead encontrado.</p>}

      {leads.isSuccess && leads.data.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Nome</TableHead>
                <TableHead>Cidade/Estado</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Redes</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Atribuído a</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.data.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <Link href={`/organizations/${organizationId}/leads/${lead.id}`} className="font-medium text-foreground hover:text-accent-400">
                      {lead.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-foreground/80">{[lead.city, lead.state].filter(Boolean).join('/') || '—'}</TableCell>
                  <TableCell className="text-foreground/80">{lead.googleCategory ?? '—'}</TableCell>
                  <TableCell>
                    <WebsiteBadge website={lead.website} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-foreground/80" title={lead.phone ?? undefined}>
                    {lead.phone ?? '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-foreground/80" title={lead.whatsapp ?? undefined}>
                    {lead.whatsapp ? (
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5 text-positive-500" />
                        {lead.whatsapp}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-foreground/80" title={lead.email ?? undefined}>
                    {lead.email ?? '—'}
                  </TableCell>
                  <TableCell>
                    <SocialBadges links={lead.socialLinks} />
                  </TableCell>
                  <TableCell className="min-w-[160px]">
                    {lead.scoreBreakdown ? <LeadScoreBar breakdown={lead.scoreBreakdown} /> : <span className="text-xs text-muted-foreground">não pontuado</span>}
                  </TableCell>
                  <TableCell>
                    <Badge value={lead.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-foreground/80">
                    {members.data?.find((m) => m.userId === lead.assignedUserId)?.user.name ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ScrapeJobsPanel organizationId={organizationId} />
    </div>
  );
}
