'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useLead, useConvertLead, useScoreLead } from '@/lib/leads/use-leads';
import { useEnrichLead, useAnalyzeLeadPotential } from '@/lib/leads/use-lead-enrichment';
import { useServiceOfferings } from '@/lib/leads/use-service-offerings';
import {
  useApproveOutreach,
  useGenerateOutreachDraft,
  useMarkOutreachReplied,
  useMarkOutreachSent,
  useRegenerateOutreach,
  useRejectOutreach,
} from '@/lib/leads/use-outreach-messages';
import { OUTREACH_CHANNELS, WRITE_ROLES, type LeadEnrichment as LeadEnrichmentDto, type OutreachMessage } from '@/lib/leads/types';
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
} from '@/components/ui/dialog';

// Mesmos estilos locais de leads/page.tsx (ver comentário lá — sem
// Input/Select/Button dark compartilhados, só o suficiente pra não repetir
// className longo por campo).
const fieldClass =
  'w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30';
const primaryButtonClass =
  'inline-flex items-center justify-center rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-ink-950 transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-md border border-ink-700 px-4 py-2 text-sm font-medium text-ink-50 transition-colors hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButtonClass =
  'inline-flex items-center justify-center rounded-md border border-negative-500/40 px-4 py-2 text-sm font-medium text-negative-500 transition-colors hover:bg-negative-500/10 disabled:cursor-not-allowed disabled:opacity-50';

function FormErrorDark({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-negative-500/30 bg-negative-500/10 px-3 py-2 text-sm text-negative-500">
      {message}
    </p>
  );
}

const CHANNEL_LABELS: Record<(typeof OUTREACH_CHANNELS)[number], string> = {
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  WHATSAPP: 'WhatsApp',
  LINKEDIN_DM: 'LinkedIn (DM)',
  REDDIT_DM: 'Reddit (DM)',
  OTHER: 'Outro',
};

const generateOutreachSchema = z.object({
  channel: z.enum(['EMAIL', 'PHONE', 'WHATSAPP', 'LINKEDIN_DM', 'REDDIT_DM', 'OTHER']),
  serviceOfferingId: z.string().optional(),
});
type GenerateOutreachFormValues = z.infer<typeof generateOutreachSchema>;

const convertLeadSchema = z.object({
  name: z.string().max(160).optional(),
  company: z.string().max(160).optional(),
});
type ConvertLeadFormValues = z.infer<typeof convertLeadSchema>;

function EnrichmentItem({ enrichment }: { enrichment: LeadEnrichmentDto }) {
  const text = enrichment.type === 'ai_analysis' && typeof enrichment.data.text === 'string' ? enrichment.data.text : null;
  return (
    <li className="rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink-50">{enrichment.type}</span>
        <span className="text-xs text-ink-500">{new Date(enrichment.createdAt).toLocaleString('pt-BR')}</span>
      </div>
      {text ? (
        <p className="mt-1 text-ink-300">{text}</p>
      ) : (
        <pre className="mt-1 overflow-x-auto text-xs text-ink-300">{JSON.stringify(enrichment.data, null, 2)}</pre>
      )}
    </li>
  );
}

function OutreachMessageCard({
  message,
  organizationId,
  leadId,
  canWrite,
}: {
  message: OutreachMessage;
  organizationId: string;
  leadId: string;
  canWrite: boolean;
}) {
  const approve = useApproveOutreach(organizationId, leadId);
  const reject = useRejectOutreach(organizationId, leadId);
  const regenerate = useRegenerateOutreach(organizationId, leadId);
  const markSent = useMarkOutreachSent(organizationId, leadId);
  const markReplied = useMarkOutreachReplied(organizationId, leadId);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Ações visíveis batem exatamente na máquina de estado de
  // outreach.service.ts: approve/reject/regenerate só a partir de DRAFT,
  // mark-sent só de APPROVED, mark-replied só de SENT — REJECTED/REPLIED
  // são terminais (sem ação além de gerar um novo rascunho, que é uma OUTRA
  // mensagem, não uma transição desta).
  return (
    <li className="rounded-md border border-ink-700 bg-ink-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge value={message.status} />
          <span className="text-xs text-ink-500">{CHANNEL_LABELS[message.channel]}</span>
        </div>
        <span className="text-xs text-ink-500">{new Date(message.createdAt).toLocaleString('pt-BR')}</span>
      </div>
      {message.subject && <p className="mt-2 text-sm font-medium text-ink-50">{message.subject}</p>}
      <p className="mt-2 whitespace-pre-wrap text-sm text-ink-300">{message.body}</p>
      {message.rejectedReason && (
        <p className="mt-2 text-xs text-negative-500">Motivo da rejeição: {message.rejectedReason}</p>
      )}

      {canWrite && message.status === 'DRAFT' && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={approve.isPending}
              onClick={() => approve.mutate(message.id)}
            >
              Aprovar
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={regenerate.isPending}
              onClick={() => regenerate.mutate(message.id)}
            >
              Regenerar
            </button>
            <button type="button" className={dangerButtonClass} onClick={() => setShowRejectReason((v) => !v)}>
              Rejeitar
            </button>
          </div>
          {showRejectReason && (
            <div className="flex flex-wrap gap-2">
              <input
                className={`${fieldClass} max-w-xs`}
                placeholder="Motivo (opcional)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <button
                type="button"
                className={dangerButtonClass}
                disabled={reject.isPending}
                onClick={() =>
                  reject.mutate(
                    { messageId: message.id, reason: rejectReason || undefined },
                    { onSuccess: () => setShowRejectReason(false) },
                  )
                }
              >
                Confirmar rejeição
              </button>
            </div>
          )}
          <FormErrorDark message={approve.isError ? (approve.error as ApiError).message : null} />
          <FormErrorDark message={reject.isError ? (reject.error as ApiError).message : null} />
          <FormErrorDark message={regenerate.isError ? (regenerate.error as ApiError).message : null} />
        </div>
      )}

      {canWrite && message.status === 'APPROVED' && (
        <div className="mt-3">
          <button type="button" className={primaryButtonClass} disabled={markSent.isPending} onClick={() => markSent.mutate(message.id)}>
            Marcar como enviada
          </button>
          <FormErrorDark message={markSent.isError ? (markSent.error as ApiError).message : null} />
        </div>
      )}

      {canWrite && message.status === 'SENT' && (
        <div className="mt-3">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={markReplied.isPending}
            onClick={() => markReplied.mutate(message.id)}
          >
            Marcar como respondida
          </button>
          <FormErrorDark message={markReplied.isError ? (markReplied.error as ApiError).message : null} />
        </div>
      )}
    </li>
  );
}

export default function LeadDetailPage() {
  const { organizationId, leadId } = useParams<{ organizationId: string; leadId: string }>();
  const router = useRouter();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;

  const lead = useLead(organizationId, leadId);
  const offerings = useServiceOfferings(organizationId, true);
  const scoreLead = useScoreLead(organizationId, leadId);
  const enrichLead = useEnrichLead(organizationId, leadId);
  const analyzeLead = useAnalyzeLeadPotential(organizationId, leadId);
  const convertLead = useConvertLead(organizationId, leadId);
  const generateDraft = useGenerateOutreachDraft(organizationId, leadId);

  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);

  const generateForm = useForm<GenerateOutreachFormValues>({
    resolver: zodResolver(generateOutreachSchema),
    defaultValues: { channel: 'EMAIL', serviceOfferingId: lead.data?.suggestedOfferingId ?? undefined },
  });
  const convertForm = useForm<ConvertLeadFormValues>({ resolver: zodResolver(convertLeadSchema) });

  const onSubmitGenerate = generateForm.handleSubmit((values) => {
    generateDraft.mutate(
      { channel: values.channel, serviceOfferingId: values.serviceOfferingId || undefined },
      { onSuccess: () => { generateForm.reset(); setShowGenerateForm(false); } },
    );
  });

  const onSubmitConvert = convertForm.handleSubmit((values) => {
    convertLead.mutate(
      { name: values.name || undefined, company: values.company || undefined },
      {
        onSuccess: (customer) => {
          setConvertDialogOpen(false);
          router.push(`/organizations/${organizationId}/customers/${customer.id}`);
        },
      },
    );
  });

  if (lead.isLoading) {
    return (
      <div className="dark -mx-4 -my-10 min-h-screen bg-ink-950 px-4 py-10 text-ink-50">
        <p className="text-ink-500">Carregando lead…</p>
      </div>
    );
  }

  if (!lead.data) {
    return (
      <div className="dark -mx-4 -my-10 min-h-screen bg-ink-950 px-4 py-10 text-ink-50">
        <p className="text-negative-500">Lead não encontrado.</p>
      </div>
    );
  }

  const data = lead.data;
  const outreachMessages = data.outreachMessages ?? [];
  const enrichments = data.enrichments ?? [];
  const alreadyConverted = Boolean(data.convertedCustomerId);

  return (
    <div className="dark -mx-4 -my-10 min-h-screen bg-ink-950 px-4 py-10 text-ink-50">
      <div className="flex flex-col gap-6">
        <div>
          <Link href={`/organizations/${organizationId}/leads`} className="text-xs text-ink-500 hover:text-accent-400">
            ← Voltar para Leads
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ink-50">{data.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge value={data.status} />
              <span className="text-xs text-ink-500">{[data.city, data.state].filter(Boolean).join('/') || '—'}</span>
              {data.googleCategory && <span className="text-xs text-ink-500">· {data.googleCategory}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <button type="button" className={secondaryButtonClass} disabled={scoreLead.isPending} onClick={() => scoreLead.mutate()}>
                {scoreLead.isPending ? 'Pontuando…' : 'Pontuar'}
              </button>
            )}
            {canWrite && (
              <button type="button" className={secondaryButtonClass} disabled={enrichLead.isPending} onClick={() => enrichLead.mutate()}>
                {enrichLead.isPending ? 'Enriquecendo…' : 'Enriquecer (Explorium)'}
              </button>
            )}
            {canWrite && (
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={analyzeLead.isPending}
                onClick={() => analyzeLead.mutate()}
              >
                {analyzeLead.isPending ? 'Analisando…' : 'Analisar potencial'}
              </button>
            )}
            {canWrite &&
              (alreadyConverted ? (
                <Link href={`/organizations/${organizationId}/customers/${data.convertedCustomerId}`} className={primaryButtonClass}>
                  Ver cliente convertido
                </Link>
              ) : (
                <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
                  <button type="button" className={primaryButtonClass} onClick={() => setConvertDialogOpen(true)}>
                    Converter em cliente
                  </button>
                  <DialogContent className="dark border-ink-700 bg-ink-900 text-ink-50">
                    <DialogHeader>
                      <DialogTitle>Converter lead em cliente</DialogTitle>
                      <DialogDescription className="text-ink-500">
                        Cria um novo Customer a partir deste lead. Sem valores informados, usa o nome do negócio para
                        nome e empresa do cliente.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={onSubmitConvert} className="flex flex-col gap-4">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-ink-300">Nome do cliente (opcional)</label>
                        <input className={fieldClass} placeholder={data.name} {...convertForm.register('name')} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-ink-300">Empresa (opcional)</label>
                        <input className={fieldClass} placeholder={data.name} {...convertForm.register('company')} />
                      </div>
                      <FormErrorDark message={convertLead.isError ? (convertLead.error as ApiError).message : null} />
                      <DialogFooter>
                        <button type="submit" className={primaryButtonClass} disabled={convertLead.isPending}>
                          {convertLead.isPending ? 'Convertendo…' : 'Confirmar conversão'}
                        </button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              ))}
          </div>
        </div>

        {analyzeLead.data && (
          <div className="rounded-lg border border-accent-500/30 bg-accent-500/10 p-4">
            <p className="mb-1 text-xs font-medium text-accent-400">Análise de IA (potencial de prospecção)</p>
            <p className="text-sm text-ink-50">{String(analyzeLead.data.data.text ?? '')}</p>
          </div>
        )}
        <FormErrorDark message={analyzeLead.isError ? (analyzeLead.error as ApiError).message : null} />
        <FormErrorDark message={scoreLead.isError ? (scoreLead.error as ApiError).message : null} />
        <FormErrorDark message={enrichLead.isError ? (enrichLead.error as ApiError).message : null} />

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
            <h2 className="mb-3 text-sm font-medium text-ink-50">Dados do negócio</h2>
            <dl className="flex flex-col gap-2 text-sm">
              <Field label="Endereço" value={data.address} />
              <Field label="Telefone" value={data.phone} />
              <Field label="E-mail" value={data.email} />
              <Field
                label="Site"
                value={
                  data.website ? (
                    <a href={data.website} target="_blank" rel="noreferrer" className="text-accent-400 hover:underline">
                      {data.website}
                    </a>
                  ) : (
                    'Sem site'
                  )
                }
              />
              <Field label="Avaliação" value={data.rating ? `${Number(data.rating)} (${data.reviewCount ?? 0} avaliações)` : null} />
              <Field label="Fonte" value={data.sourceType} />
              <Field label="Descoberto em" value={new Date(data.discoveredAt).toLocaleString('pt-BR')} />
            </dl>
          </section>

          <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
            <h2 className="mb-3 text-sm font-medium text-ink-50">Score de qualificação</h2>
            {data.scoreBreakdown ? (
              <LeadScoreBar breakdown={data.scoreBreakdown} />
            ) : (
              <p className="text-sm text-ink-500">Lead ainda não foi pontuado.</p>
            )}
          </section>
        </div>

        <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-ink-50">Histórico de enriquecimento</h2>
          {enrichments.length === 0 ? (
            <p className="text-sm text-ink-500">Nenhum enriquecimento registrado ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {enrichments.map((enrichment) => (
                <EnrichmentItem key={enrichment.id} enrichment={enrichment} />
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-50">Outreach</h2>
            {canWrite && (
              <button type="button" className={secondaryButtonClass} onClick={() => setShowGenerateForm((v) => !v)}>
                + Gerar rascunho
              </button>
            )}
          </div>

          {showGenerateForm && (
            <form onSubmit={onSubmitGenerate} className="mb-4 flex flex-col gap-4 rounded-md border border-ink-700 bg-ink-950 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-300">Canal</label>
                  <select className={fieldClass} {...generateForm.register('channel')}>
                    {OUTREACH_CHANNELS.map((channel) => (
                      <option key={channel} value={channel}>
                        {CHANNEL_LABELS[channel]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-300">Oferta de serviço</label>
                  <select className={fieldClass} {...generateForm.register('serviceOfferingId')}>
                    <option value="">
                      {data.suggestedOfferingId ? 'Usar sugestão do score' : 'Selecione uma oferta'}
                    </option>
                    {offerings.data?.map((offering) => (
                      <option key={offering.id} value={offering.id}>
                        {offering.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <FormErrorDark message={generateDraft.isError ? (generateDraft.error as ApiError).message : null} />
              <div>
                <button type="submit" className={primaryButtonClass} disabled={generateDraft.isPending}>
                  {generateDraft.isPending ? 'Gerando…' : 'Gerar rascunho'}
                </button>
              </div>
            </form>
          )}

          {outreachMessages.length === 0 ? (
            <p className="text-sm text-ink-500">Nenhuma mensagem de outreach gerada ainda.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {outreachMessages.map((message) => (
                <OutreachMessageCard
                  key={message.id}
                  message={message}
                  organizationId={organizationId}
                  leadId={leadId}
                  canWrite={canWrite}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right text-ink-50">{value ?? '—'}</dd>
    </div>
  );
}
