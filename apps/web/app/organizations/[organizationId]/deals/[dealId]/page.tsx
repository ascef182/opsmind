'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useCustomer } from '@/lib/customers/use-customers';
import {
  downloadDealProposalPdf,
  useDeal,
  useGenerateDealProposal,
  useMoveDealStage,
  useRequestSignature,
  useSignatureRequests,
  useUpdateDeal,
} from '@/lib/deals/use-deals';
import {
  DEAL_STAGE_LABELS,
  DEAL_STAGE_TRANSITIONS,
  WRITE_ROLES,
  formatCurrency,
  type DealStage,
} from '@/lib/deals/types';
import {
  useCancelMeeting,
  useCreateMeeting,
  useMeetings,
  downloadMeetingIcs,
} from '@/lib/meetings/use-meetings';
import { buildGoogleCalendarUrl } from '@/lib/meetings/types';
import { useCreateDealNote, useDealNotes } from '@/lib/collaboration/use-internal-notes';
import { DealContractCard } from '@/components/finance/deal-contract-card';
import { InternalNotesCard } from '@/components/collaboration/internal-notes-card';
import { ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, FormError } from '@/components/ui/card';

export default function DealDetailPage() {
  const { organizationId, dealId } = useParams<{ organizationId: string; dealId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;

  const deal = useDeal(organizationId, dealId);
  const customer = useCustomer(organizationId, deal.data?.customerId ?? '');
  const moveStage = useMoveDealStage(organizationId, dealId);
  const updateDeal = useUpdateDeal(organizationId, dealId);
  const generateProposal = useGenerateDealProposal(organizationId, dealId);
  const signatureRequests = useSignatureRequests(organizationId, dealId);
  const requestSignature = useRequestSignature(organizationId, dealId);
  const meetings = useMeetings(organizationId, dealId);
  const createMeeting = useCreateMeeting(organizationId, dealId);
  const cancelMeeting = useCancelMeeting(organizationId, dealId);
  const dealNotes = useDealNotes(organizationId, dealId);
  const createDealNote = useCreateDealNote(organizationId, dealId);
  const [icsError, setIcsError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  if (deal.isLoading) {
    return <p className="text-muted-foreground">Carregando negócio…</p>;
  }
  if (deal.isError || !deal.data) {
    return <p className="text-destructive">Negócio não encontrado.</p>;
  }

  const nextStages = DEAL_STAGE_TRANSITIONS[deal.data.stage];

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/organizations/${organizationId}/deals`} className="text-sm text-accent-500 hover:underline">
        ← Voltar para negócios
      </Link>

      <Card className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">{deal.data.title}</h1>
          {customer.data && (
            <Link
              href={`/organizations/${organizationId}/customers/${customer.data.id}`}
              className="text-sm text-accent-500 hover:underline"
            >
              {customer.data.company ?? customer.data.name}
            </Link>
          )}
          <p className="text-lg font-medium text-foreground">
            {formatCurrency(deal.data.value, deal.data.currency)}
          </p>
          {deal.data.expectedCloseDate && (
            <p className="text-sm text-muted-foreground">
              Previsão de fechamento: {new Date(deal.data.expectedCloseDate).toLocaleDateString('pt-BR')}
            </p>
          )}
          {deal.data.actualCloseDate && (
            <p className="text-sm text-muted-foreground">
              Fechado em {new Date(deal.data.actualCloseDate).toLocaleDateString('pt-BR')}
            </p>
          )}
          {deal.data.lostReason && (
            <p className="text-sm text-negative-500">Motivo da perda: {deal.data.lostReason}</p>
          )}
          {deal.data.originLeadId && (
            <Link
              href={`/organizations/${organizationId}/leads/${deal.data.originLeadId}`}
              className="text-xs text-accent-500 hover:underline"
            >
              Ver lead de origem
            </Link>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge value={deal.data.stage} />
          {canWrite && nextStages.length > 0 && (
            <Select
              value=""
              disabled={moveStage.isPending}
              onChange={(e) => {
                const stage = e.target.value as DealStage;
                if (!stage) return;
                if (stage === 'LOST') {
                  const reason = window.prompt('Motivo da perda:');
                  if (!reason) return;
                  moveStage.mutate({ stage, lostReason: reason });
                  return;
                }
                moveStage.mutate({ stage });
              }}
              className="w-48"
            >
              <option value="">Mover para…</option>
              {nextStages.map((stage) => (
                <option key={stage} value={stage}>
                  {DEAL_STAGE_LABELS[stage]}
                </option>
              ))}
            </Select>
          )}
        </div>
      </Card>

      <DealContractCard
        organizationId={organizationId}
        dealId={dealId}
        dealStage={deal.data.stage}
      />

      {canWrite && (
        <Card>
          <h2 className="font-medium text-foreground">Editar</h2>
          <form
            className="mt-3 grid grid-cols-2 gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const title = String(form.get('title') ?? '');
              const value = Number(form.get('value'));
              const expectedCloseDate = String(form.get('expectedCloseDate') ?? '');
              updateDeal.mutate({
                title: title || undefined,
                value: Number.isFinite(value) && value >= 0 ? value : undefined,
                expectedCloseDate: expectedCloseDate || undefined,
              });
            }}
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Título</label>
              <Input name="title" defaultValue={deal.data.title} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Valor</label>
              <Input name="value" type="number" min={0} step="0.01" defaultValue={deal.data.value} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Previsão de fechamento
              </label>
              <Input
                name="expectedCloseDate"
                type="date"
                defaultValue={deal.data.expectedCloseDate?.slice(0, 10) ?? ''}
              />
            </div>
            <div className="col-span-2 flex justify-end">
              <Button type="submit" disabled={updateDeal.isPending}>
                {updateDeal.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {canWrite && (
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-foreground">Proposta</h2>
            <div className="flex items-center gap-2">
              {deal.data.proposalDraft && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPdfError(null);
                    downloadDealProposalPdf(organizationId, dealId, `proposta-${dealId}.pdf`).catch(() =>
                      setPdfError('Não foi possível baixar o PDF da proposta'),
                    );
                  }}
                >
                  Baixar PDF
                </Button>
              )}
              <Button size="sm" disabled={generateProposal.isPending} onClick={() => generateProposal.mutate()}>
                {generateProposal.isPending
                  ? 'Gerando…'
                  : deal.data.proposalDraft
                    ? 'Gerar novamente'
                    : 'Gerar proposta'}
              </Button>
            </div>
          </div>
          <FormError
            message={generateProposal.isError ? (generateProposal.error as ApiError).message : null}
          />
          <FormError message={pdfError} />
          {deal.data.proposalDraft ? (
            <form
              key={deal.data.proposalGeneratedAt ?? deal.data.proposalDraft}
              className="mt-3 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                updateDeal.mutate({ proposalDraft: String(form.get('proposalDraft') ?? '') });
              }}
            >
              <Textarea name="proposalDraft" rows={12} defaultValue={deal.data.proposalDraft} />
              {deal.data.proposalGeneratedAt && (
                <p className="text-xs text-muted-foreground">
                  Gerada em {new Date(deal.data.proposalGeneratedAt).toLocaleString('pt-BR')} — minuta editável,
                  revise antes de enviar ao cliente.
                </p>
              )}
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={updateDeal.isPending}>
                  {updateDeal.isPending ? 'Salvando…' : 'Salvar edição'}
                </Button>
              </div>
            </form>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhuma proposta gerada ainda para este negócio.
            </p>
          )}
        </Card>
      )}

      {canWrite && (
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-foreground">Assinatura eletrônica</h2>
            {deal.data.proposalDraft && (
              <Button
                size="sm"
                disabled={requestSignature.isPending}
                onClick={() => requestSignature.mutate()}
              >
                {requestSignature.isPending ? 'Enviando…' : 'Enviar para assinatura'}
              </Button>
            )}
          </div>
          <FormError
            message={requestSignature.isError ? (requestSignature.error as ApiError).message : null}
          />
          {!deal.data.proposalDraft && (
            <p className="mt-3 text-sm text-muted-foreground">
              Gere a proposta acima antes de enviar para assinatura.
            </p>
          )}
          {signatureRequests.isLoading && (
            <p className="mt-3 text-sm text-muted-foreground">Carregando solicitações…</p>
          )}
          {signatureRequests.isSuccess && signatureRequests.data.length === 0 && deal.data.proposalDraft && (
            <p className="mt-3 text-sm text-muted-foreground">Nenhuma solicitação de assinatura enviada ainda.</p>
          )}
          <ul className="mt-3 flex flex-col gap-2">
            {signatureRequests.data?.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="text-foreground">{request.signerName}</span>
                  <span className="text-xs text-muted-foreground">
                    {request.signerEmail} · enviado em {new Date(request.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge value={request.status} />
                  {request.status === 'SIGNED' && request.documentUrl && (
                    <a
                      href={request.documentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent-500 hover:underline"
                    >
                      Ver documento assinado
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="font-medium text-foreground">Reuniões</h2>

        {canWrite && (
          <form
            className="mt-3 grid grid-cols-2 gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const title = String(form.get('title') ?? '');
              const scheduledAt = String(form.get('scheduledAt') ?? '');
              if (!title || !scheduledAt) return;
              createMeeting.mutate(
                {
                  title,
                  scheduledAt: new Date(scheduledAt).toISOString(),
                  location: String(form.get('location') ?? '') || undefined,
                  notes: String(form.get('notes') ?? '') || undefined,
                },
                { onSuccess: () => (e.target as HTMLFormElement).reset() },
              );
            }}
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Título</label>
              <Input name="title" placeholder="Call de fechamento" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Data e hora</label>
              <Input name="scheduledAt" type="datetime-local" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Local (opcional)</label>
              <Input name="location" placeholder="Link da chamada ou endereço" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Notas (opcional)</label>
              <Input name="notes" placeholder="Pauta da reunião" />
            </div>
            <div className="col-span-2 flex justify-end">
              <Button type="submit" size="sm" disabled={createMeeting.isPending}>
                {createMeeting.isPending ? 'Agendando…' : 'Agendar reunião'}
              </Button>
            </div>
          </form>
        )}
        <FormError message={createMeeting.isError ? (createMeeting.error as ApiError).message : null} />
        <FormError message={icsError} />

        {meetings.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando reuniões…</p>}
        {meetings.isSuccess && meetings.data.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma reunião agendada ainda.</p>
        )}
        <ul className="mt-3 flex flex-col gap-2">
          {meetings.data?.map((meeting) => (
            <li
              key={meeting.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <div className="flex flex-col">
                <span className={meeting.canceledAt ? 'text-muted-foreground line-through' : 'text-foreground'}>
                  {meeting.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(meeting.scheduledAt).toLocaleString('pt-BR')} ({meeting.durationMinutes} min)
                  {meeting.location ? ` · ${meeting.location}` : ''}
                </span>
              </div>
              {!meeting.canceledAt && (
                <div className="flex items-center gap-2">
                  <a
                    href={buildGoogleCalendarUrl(meeting)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent-500 hover:underline"
                  >
                    Google Calendar
                  </a>
                  <button
                    type="button"
                    className="text-xs text-accent-500 hover:underline"
                    onClick={() => {
                      setIcsError(null);
                      downloadMeetingIcs(organizationId, meeting.id, `reuniao-${meeting.id}.ics`).catch(() =>
                        setIcsError('Não foi possível baixar o arquivo .ics'),
                      );
                    }}
                  >
                    Baixar .ics
                  </button>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-negative-500"
                      disabled={cancelMeeting.isPending}
                      onClick={() => cancelMeeting.mutate(meeting.id)}
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <InternalNotesCard
        organizationId={organizationId}
        notes={dealNotes.data}
        isLoading={dealNotes.isLoading}
        canWrite={canWrite}
        onCreate={(input) => createDealNote.mutate(input)}
        isCreating={createDealNote.isPending}
        createError={createDealNote.isError ? createDealNote.error : null}
      />
    </div>
  );
}
