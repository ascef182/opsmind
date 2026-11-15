'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useCurrentMembership, useMembers } from '@/lib/memberships/use-memberships';
import {
  useApproveOutreach,
  useEditOutreach,
  useMarkOutreachRead,
  useOutreachMessages,
  useRejectOutreach,
} from '@/lib/leads/use-outreach-messages';
import { WRITE_ROLES, type OutreachMessage, type OutreachStatus } from '@/lib/leads/types';
import { ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/components/ui/card';

const STATUS_OPTIONS: Array<{ value: OutreachStatus | ''; label: string }> = [
  { value: 'DRAFT', label: 'Aguardando aprovação (rascunho)' },
  { value: 'APPROVED', label: 'Aprovadas' },
  { value: 'REJECTED', label: 'Rejeitadas' },
  { value: 'SENT', label: 'Enviadas' },
  { value: 'REPLIED', label: 'Respondidas' },
  { value: '', label: 'Todas' },
];

const CHANNEL_LABELS: Record<OutreachMessage['channel'], string> = {
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  WHATSAPP: 'WhatsApp',
  LINKEDIN_DM: 'LinkedIn (DM)',
  REDDIT_DM: 'Reddit (DM)',
  INSTAGRAM_DM: 'Instagram (DM)',
  OTHER: 'Outro',
};

// Card de fila de aprovação — mesmo visual de `OutreachMessageCard`
// (leads/[leadId]/page.tsx), mas só com as ações que a fila global sempre
// expôs (Aprovar/Rejeitar). Não inclui nome/dados do lead no card: o
// endpoint `GET .../outreach-messages` não faz join com `Lead` (só
// `leadId`), e adicionar esse join é uma mudança de backend fora do escopo
// desta reforma visual — por isso o link "Ver lead" é a única referência ao
// negócio por trás da mensagem.
function QueueCard({
  message,
  organizationId,
  canWrite,
  assigneeName,
}: {
  message: OutreachMessage;
  organizationId: string;
  canWrite: boolean;
  assigneeName: string | null;
}) {
  const approve = useApproveOutreach(organizationId, message.leadId);
  const reject = useRejectOutreach(organizationId, message.leadId);
  const edit = useEditOutreach(organizationId, message.leadId);
  const markRead = useMarkOutreachRead(organizationId);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);

  // "Não lida" só faz sentido pra mensagens que já saíram do fluxo de
  // aprovação (SENT/REPLIED) — um DRAFT/APPROVED/REJECTED já é acompanhado
  // pelo próprio status da fila, sem precisar de um segundo indicador.
  const showsReadState = message.status === 'SENT' || message.status === 'REPLIED';
  const isUnread = showsReadState && !message.readAt;

  return (
    <li
      className={`rounded-lg border p-4 ${isUnread ? 'border-accent-500/50 bg-accent-500/5' : 'border-border bg-card'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isUnread && <span className="size-2 rounded-full bg-accent-500" title="Não lida" />}
          <Badge value={message.status} />
          <span className="text-xs text-muted-foreground">{CHANNEL_LABELS[message.channel]}</span>
          {message.lead && (
            <Link
              href={`/organizations/${organizationId}/leads/${message.leadId}`}
              className="text-xs font-medium text-accent-400 hover:underline"
            >
              {message.lead.name}
            </Link>
          )}
          {assigneeName && <span className="text-xs text-muted-foreground">· {assigneeName}</span>}
        </div>
        <div className="flex items-center gap-2">
          {showsReadState && (
            <span className="text-xs text-muted-foreground">
              {message.readAt ? 'Lida' : (
                <button
                  type="button"
                  className="text-accent-400 hover:underline"
                  disabled={markRead.isPending}
                  onClick={() => markRead.mutate(message.id)}
                >
                  Marcar como lida
                </button>
              )}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{new Date(message.createdAt).toLocaleString('pt-BR')}</span>
        </div>
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

      <Link
        href={`/organizations/${organizationId}/leads/${message.leadId}`}
        className="mt-3 inline-block text-xs font-medium text-accent-400 hover:underline"
      >
        Ver lead →
      </Link>

      {/* Só DRAFT pode ser aprovada/rejeitada/editada — mesma máquina de
          estado de outreach.service.ts (approve/reject exigem
          `fromStatus: 'DRAFT'`; edit usa a mesma guarda, só que sem mudar
          status). */}
      {canWrite && message.status === 'DRAFT' && !isEditing && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
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
                className="max-w-[220px]"
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
                Confirmar
              </Button>
            </div>
          )}
          <FormError message={approve.isError ? (approve.error as ApiError).message : null} />
          <FormError message={reject.isError ? (reject.error as ApiError).message : null} />
        </div>
      )}
    </li>
  );
}

export default function OutreachQueuePage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;
  const members = useMembers(organizationId);

  // Default DRAFT (fila de aprovação) — mesmo default do brief/controller
  // (`GET outreach-messages?status=DRAFT`).
  const [status, setStatus] = useState<OutreachStatus | ''>('DRAFT');
  // "Minhas" (Trilha B) — filtra por Lead.assignedUserId === eu mesmo,
  // reaproveitando o roteamento da B1; default "Todas" (visão de equipe).
  const [mineOnly, setMineOnly] = useState(false);
  const messages = useOutreachMessages(organizationId, { status: status || undefined, mine: mineOnly });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Outreach (inbox compartilhada)</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              className={`px-3 py-1.5 text-xs font-medium ${!mineOnly ? 'bg-accent-500/15 text-accent-400' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setMineOnly(false)}
            >
              Todas
            </button>
            <button
              type="button"
              className={`border-l border-border px-3 py-1.5 text-xs font-medium ${mineOnly ? 'bg-accent-500/15 text-accent-400' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => setMineOnly(true)}
            >
              Minhas
            </button>
          </div>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as OutreachStatus | '')}
            className="max-w-[280px]"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {messages.isLoading && <p className="text-muted-foreground">Carregando mensagens…</p>}
      {messages.isSuccess && messages.data.length === 0 && (
        <p className="text-muted-foreground">Nenhuma mensagem de outreach nesse filtro.</p>
      )}

      {messages.isSuccess && messages.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {messages.data.map((message) => (
            <QueueCard
              key={message.id}
              message={message}
              organizationId={organizationId}
              canWrite={canWrite}
              assigneeName={
                message.lead?.assignedUserId
                  ? (members.data?.find((m) => m.userId === message.lead?.assignedUserId)?.user.name ?? null)
                  : null
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
