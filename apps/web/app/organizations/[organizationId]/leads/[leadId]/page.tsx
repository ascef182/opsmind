'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { isSafeHttpUrl } from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useLead, useConvertLead, useScoreLead } from '@/lib/leads/use-leads';
import { useEnrichLead, useAnalyzeLeadPotential } from '@/lib/leads/use-lead-enrichment';
import { useServiceOfferings } from '@/lib/leads/use-service-offerings';
import {
  useApproveOutreach,
  useEditOutreach,
  useGenerateOutreachDraft,
  useMarkOutreachReplied,
  useMarkOutreachSent,
  useRegenerateOutreach,
  useRejectOutreach,
} from '@/lib/leads/use-outreach-messages';
import { OUTREACH_CHANNELS, WRITE_ROLES, type LeadEnrichment as LeadEnrichmentDto, type OutreachMessage } from '@/lib/leads/types';
import { ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
} from '@/components/ui/dialog';

const CHANNEL_LABELS: Record<(typeof OUTREACH_CHANNELS)[number], string> = {
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  WHATSAPP: 'WhatsApp',
  LINKEDIN_DM: 'LinkedIn (DM)',
  REDDIT_DM: 'Reddit (DM)',
  INSTAGRAM_DM: 'Instagram (DM)',
  OTHER: 'Outro',
};

const generateOutreachSchema = z.object({
  channel: z.enum(['EMAIL', 'PHONE', 'WHATSAPP', 'LINKEDIN_DM', 'REDDIT_DM', 'INSTAGRAM_DM', 'OTHER']),
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
    <li className="rounded-md border border-border bg-background px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{enrichment.type}</span>
        <span className="text-xs text-muted-foreground">{new Date(enrichment.createdAt).toLocaleString('pt-BR')}</span>
      </div>
      {text ? (
        <p className="mt-1 text-foreground/80">{text}</p>
      ) : (
        <pre className="mt-1 overflow-x-auto text-xs text-foreground/80">{JSON.stringify(enrichment.data, null, 2)}</pre>
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
  const edit = useEditOutreach(organizationId, leadId);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);

  // Ações visíveis batem exatamente na máquina de estado de
  // outreach.service.ts: approve/reject/regenerate só a partir de DRAFT,
  // mark-sent só de APPROVED, mark-replied só de SENT — REJECTED/REPLIED
  // são terminais (sem ação além de gerar um novo rascunho, que é uma OUTRA
  // mensagem, não uma transição desta). "Editar" (Task 15) também só existe
  // em DRAFT — não é uma transição de status, mas segue a mesma guarda.
  return (
    <li className="rounded-md border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge value={message.status} />
          <span className="text-xs text-muted-foreground">{CHANNEL_LABELS[message.channel]}</span>
        </div>
        <span className="text-xs text-muted-foreground">{new Date(message.createdAt).toLocaleString('pt-BR')}</span>
      </div>
      {message.subject && <p className="mt-2 text-sm font-medium text-foreground">{message.subject}</p>}
      {isEditing ? (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea
            rows={5}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            maxLength={4000}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={edit.isPending || editBody.trim().length === 0}
              onClick={() =>
                edit.mutate(
                  { messageId: message.id, body: editBody },
                  { onSuccess: () => setIsEditing(false) },
                )
              }
            >
              Salvar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={edit.isPending}
              onClick={() => {
                setEditBody(message.body);
                setIsEditing(false);
              }}
            >
              Cancelar
            </Button>
          </div>
          <FormError message={edit.isError ? (edit.error as ApiError).message : null} />
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{message.body}</p>
      )}
      {message.rejectedReason && (
        <p className="mt-2 text-xs text-negative-500">Motivo da rejeição: {message.rejectedReason}</p>
      )}

      {canWrite && message.status === 'DRAFT' && !isEditing && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(message.id)}>
              Aprovar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditBody(message.body);
                setIsEditing(true);
              }}
            >
              Editar
            </Button>
            <Button size="sm" variant="secondary" disabled={regenerate.isPending} onClick={() => regenerate.mutate(message.id)}>
              Regenerar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="border border-negative-500/40 text-negative-500 hover:bg-negative-500/10"
              onClick={() => setShowRejectReason((v) => !v)}
            >
              Rejeitar
            </Button>
          </div>
          {showRejectReason && (
            <div className="flex flex-wrap gap-2">
              <Input
                className="max-w-xs"
                placeholder="Motivo (opcional)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <Button
                size="sm"
                variant="ghost"
                className="border border-negative-500/40 text-negative-500 hover:bg-negative-500/10"
                disabled={reject.isPending}
                onClick={() =>
                  reject.mutate(
                    { messageId: message.id, reason: rejectReason || undefined },
                    { onSuccess: () => setShowRejectReason(false) },
                  )
                }
              >
                Confirmar rejeição
              </Button>
            </div>
          )}
          <FormError message={approve.isError ? (approve.error as ApiError).message : null} />
          <FormError message={reject.isError ? (reject.error as ApiError).message : null} />
          <FormError message={regenerate.isError ? (regenerate.error as ApiError).message : null} />
        </div>
      )}

      {canWrite && message.status === 'APPROVED' && (
        <div className="mt-3">
          <Button size="sm" disabled={markSent.isPending} onClick={() => markSent.mutate(message.id)}>
            Marcar como enviada
          </Button>
          <FormError message={markSent.isError ? (markSent.error as ApiError).message : null} />
        </div>
      )}

      {canWrite && message.status === 'SENT' && (
        <div className="mt-3">
          <Button size="sm" disabled={markReplied.isPending} onClick={() => markReplied.mutate(message.id)}>
            Marcar como respondida
          </Button>
          <FormError message={markReplied.isError ? (markReplied.error as ApiError).message : null} />
        </div>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value ?? '—'}</dd>
    </div>
  );
}

// Painel "Lead Intelligence": fatos do negócio + score + oferta sugerida +
// as ações de enriquecimento, num só lugar lateral em vez de espalhados
// pelo topo da página. Mostra só dados que realmente existem no modelo —
// WhatsApp/nome de contato/redes sociais (Task 4/5) entraram no modelo e
// aparecem aqui junto de telefone/e-mail; o que continua de fora é qualquer
// "maturidade digital" inferida sem fonte de dado real (ver LeadScoreBar
// para o único "score" de fato calculado).
function LeadIntelligencePanel({
  data,
  offeringName,
  canWrite,
  onScore,
  scoreLoading,
  scoreError,
  onEnrich,
  enrichLoading,
  enrichError,
  onAnalyze,
  analyzeLoading,
  analyzeError,
  convertSlot,
}: {
  data: NonNullable<ReturnType<typeof useLead>['data']>;
  offeringName: string | null;
  canWrite: boolean;
  onScore: () => void;
  scoreLoading: boolean;
  scoreError: string | null;
  onEnrich: () => void;
  enrichLoading: boolean;
  enrichError: string | null;
  onAnalyze: () => void;
  analyzeLoading: boolean;
  analyzeError: string | null;
  convertSlot: React.ReactNode;
}) {
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium text-foreground">Lead Intelligence</h2>
        <dl className="flex flex-col gap-2">
          <Field
            label="Site"
            value={
              // Mesma regra de `SocialBadges`: `Lead.website` também vem de
              // raspagem (escrita direto no Prisma pelo worker), então só
              // vira `href` quando é http/https — caso contrário aparece
              // como texto, nunca clicável.
              data.website ? (
                isSafeHttpUrl(data.website) ? (
                  <a href={data.website} target="_blank" rel="noreferrer" className="text-accent-400 hover:underline">
                    {data.website}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{data.website}</span>
                )
              ) : (
                'Sem site'
              )
            }
          />
          <Field label="Telefone" value={data.phone} />
          <Field label="WhatsApp" value={data.whatsapp} />
          <Field label="E-mail" value={data.email} />
          <Field label="Nome de contato" value={data.contactName} />
          <Field label="Redes" value={<SocialBadges links={data.socialLinks} />} />
          <Field label="Avaliação" value={data.rating ? `${Number(data.rating)} (${data.reviewCount ?? 0} avaliações)` : null} />
          <Field label="Endereço" value={data.address} />
          <Field label="Fonte" value={data.sourceType} />
          <Field label="Descoberto em" value={new Date(data.discoveredAt).toLocaleString('pt-BR')} />
        </dl>

        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Score de qualificação</p>
          {data.scoreBreakdown ? (
            <LeadScoreBar breakdown={data.scoreBreakdown} />
          ) : (
            <p className="text-sm text-muted-foreground">Lead ainda não foi pontuado.</p>
          )}
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Oferta sugerida</p>
          <p className="text-sm text-foreground">{offeringName ?? 'Nenhuma sugestão ainda'}</p>
        </div>
      </section>

      {canWrite && (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <Button variant="secondary" size="sm" disabled={scoreLoading} onClick={onScore}>
            {scoreLoading ? 'Pontuando…' : 'Pontuar'}
          </Button>
          <FormError message={scoreError} />
          <Button variant="secondary" size="sm" disabled={enrichLoading} onClick={onEnrich}>
            {enrichLoading ? 'Enriquecendo…' : 'Enriquecer (Explorium)'}
          </Button>
          <FormError message={enrichError} />
          <Button variant="secondary" size="sm" disabled={analyzeLoading} onClick={onAnalyze}>
            {analyzeLoading ? 'Analisando…' : 'Analisar potencial'}
          </Button>
          <FormError message={analyzeError} />
          {convertSlot}
        </section>
      )}
    </aside>
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
    return <p className="text-muted-foreground">Carregando lead…</p>;
  }

  if (!lead.data) {
    return <p className="text-negative-500">Lead não encontrado.</p>;
  }

  const data = lead.data;
  const outreachMessages = data.outreachMessages ?? [];
  const enrichments = data.enrichments ?? [];
  const alreadyConverted = Boolean(data.convertedCustomerId);
  const suggestedOffering = offerings.data?.find((o) => o.id === data.suggestedOfferingId) ?? null;

  const convertSlot = alreadyConverted ? (
    <Button asChild size="sm">
      <Link href={`/organizations/${organizationId}/customers/${data.convertedCustomerId}`}>Ver cliente convertido</Link>
    </Button>
  ) : (
    <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
      <Button size="sm" onClick={() => setConvertDialogOpen(true)}>
        Converter em cliente
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Converter lead em cliente</DialogTitle>
          <DialogDescription>
            Cria um novo Customer a partir deste lead. Sem valores informados, usa o nome do negócio para nome e
            empresa do cliente.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmitConvert} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome do cliente (opcional)</label>
            <Input placeholder={data.name} {...convertForm.register('name')} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Empresa (opcional)</label>
            <Input placeholder={data.name} {...convertForm.register('company')} />
          </div>
          <FormError message={convertLead.isError ? (convertLead.error as ApiError).message : null} />
          <DialogFooter>
            <Button type="submit" disabled={convertLead.isPending}>
              {convertLead.isPending ? 'Convertendo…' : 'Confirmar conversão'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/organizations/${organizationId}/leads`} className="text-xs text-muted-foreground hover:text-accent-400">
          ← Voltar para Leads
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-foreground">{data.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge value={data.status} />
          <span className="text-xs text-muted-foreground">{[data.city, data.state].filter(Boolean).join('/') || '—'}</span>
          {data.googleCategory && <span className="text-xs text-muted-foreground">· {data.googleCategory}</span>}
        </div>
      </div>

      {analyzeLead.data && (
        <div className="rounded-lg border border-accent-500/30 bg-accent-500/10 p-4">
          <p className="mb-1 text-xs font-medium text-accent-400">Análise de IA (potencial de prospecção)</p>
          <p className="text-sm text-foreground">{String(analyzeLead.data.data.text ?? '')}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-medium text-foreground">Histórico de enriquecimento</h2>
            {enrichments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum enriquecimento registrado ainda.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {enrichments.map((enrichment) => (
                  <EnrichmentItem key={enrichment.id} enrichment={enrichment} />
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-foreground">Outreach</h2>
              {canWrite && (
                <Button variant="secondary" size="sm" onClick={() => setShowGenerateForm((v) => !v)}>
                  + Gerar rascunho
                </Button>
              )}
            </div>

            {showGenerateForm && (
              <form onSubmit={onSubmitGenerate} className="mb-4 flex flex-col gap-4 rounded-md border border-border bg-background p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Canal</label>
                    <Select {...generateForm.register('channel')}>
                      {OUTREACH_CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>
                          {CHANNEL_LABELS[channel]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Oferta de serviço</label>
                    <Select {...generateForm.register('serviceOfferingId')}>
                      <option value="">{data.suggestedOfferingId ? 'Usar sugestão do score' : 'Selecione uma oferta'}</option>
                      {offerings.data?.map((offering) => (
                        <option key={offering.id} value={offering.id}>
                          {offering.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <FormError message={generateDraft.isError ? (generateDraft.error as ApiError).message : null} />
                <div>
                  <Button type="submit" disabled={generateDraft.isPending}>
                    {generateDraft.isPending ? 'Gerando…' : 'Gerar rascunho'}
                  </Button>
                </div>
              </form>
            )}

            {outreachMessages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma mensagem de outreach gerada ainda.</p>
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

        <LeadIntelligencePanel
          data={data}
          offeringName={suggestedOffering?.name ?? null}
          canWrite={canWrite}
          onScore={() => scoreLead.mutate()}
          scoreLoading={scoreLead.isPending}
          scoreError={scoreLead.isError ? (scoreLead.error as ApiError).message : null}
          onEnrich={() => enrichLead.mutate()}
          enrichLoading={enrichLead.isPending}
          enrichError={enrichLead.isError ? (enrichLead.error as ApiError).message : null}
          onAnalyze={() => analyzeLead.mutate()}
          analyzeLoading={analyzeLead.isPending}
          analyzeError={analyzeLead.isError ? (analyzeLead.error as ApiError).message : null}
          convertSlot={convertSlot}
        />
      </div>
    </div>
  );
}
