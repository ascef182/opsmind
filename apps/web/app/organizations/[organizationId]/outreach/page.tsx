'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useApproveOutreach, useOutreachMessages, useRejectOutreach } from '@/lib/leads/use-outreach-messages';
import { WRITE_ROLES, type OutreachMessage, type OutreachStatus } from '@/lib/leads/types';
import { ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Mesmos estilos locais das outras páginas desta feature (ver
// leads/page.tsx) — sem Input/Select/Button dark compartilhados ainda.
const fieldClass =
  'w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-50 placeholder:text-ink-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30';
const primaryButtonClass =
  'inline-flex items-center justify-center rounded-md bg-accent-500 px-3 py-1.5 text-xs font-medium text-ink-950 transition-colors hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50';
const dangerButtonClass =
  'inline-flex items-center justify-center rounded-md border border-negative-500/40 px-3 py-1.5 text-xs font-medium text-negative-500 transition-colors hover:bg-negative-500/10 disabled:cursor-not-allowed disabled:opacity-50';

function FormErrorDark({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-negative-500/30 bg-negative-500/10 px-3 py-2 text-sm text-negative-500">
      {message}
    </p>
  );
}

const STATUS_OPTIONS: Array<{ value: OutreachStatus | ''; label: string }> = [
  { value: 'DRAFT', label: 'Aguardando aprovação (rascunho)' },
  { value: 'APPROVED', label: 'Aprovadas' },
  { value: 'REJECTED', label: 'Rejeitadas' },
  { value: 'SENT', label: 'Enviadas' },
  { value: 'REPLIED', label: 'Respondidas' },
  { value: '', label: 'Todas' },
];

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function QueueRow({
  message,
  organizationId,
  canWrite,
}: {
  message: OutreachMessage;
  organizationId: string;
  canWrite: boolean;
}) {
  const approve = useApproveOutreach(organizationId, message.leadId);
  const reject = useRejectOutreach(organizationId, message.leadId);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  return (
    <TableRow className="border-ink-700 hover:bg-ink-800">
      <TableCell>
        <Link
          href={`/organizations/${organizationId}/leads/${message.leadId}`}
          className="font-medium text-accent-400 hover:underline"
        >
          Ver lead →
        </Link>
      </TableCell>
      <TableCell className="text-ink-300">{message.channel}</TableCell>
      <TableCell className="max-w-sm text-ink-300">{truncate(message.body, 140)}</TableCell>
      <TableCell>
        <Badge value={message.status} />
      </TableCell>
      <TableCell className="text-ink-500">{new Date(message.createdAt).toLocaleString('pt-BR')}</TableCell>
      <TableCell>
        {/* Só DRAFT pode ser aprovada/rejeitada — mesma máquina de estado de
            outreach.service.ts (approve/reject exigem `fromStatus: 'DRAFT'`). */}
        {canWrite && message.status === 'DRAFT' && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <button type="button" className={primaryButtonClass} disabled={approve.isPending} onClick={() => approve.mutate(message.id)}>
                Aprovar
              </button>
              <button type="button" className={dangerButtonClass} onClick={() => setShowRejectReason((v) => !v)}>
                Rejeitar
              </button>
            </div>
            {showRejectReason && (
              <div className="flex gap-2">
                <input
                  className={`${fieldClass} max-w-[180px]`}
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
                  Confirmar
                </button>
              </div>
            )}
            <FormErrorDark message={approve.isError ? (approve.error as ApiError).message : null} />
            <FormErrorDark message={reject.isError ? (reject.error as ApiError).message : null} />
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

export default function OutreachQueuePage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;

  // Default DRAFT (fila de aprovação) — mesmo default do brief/controller
  // (`GET outreach-messages?status=DRAFT`).
  const [status, setStatus] = useState<OutreachStatus | ''>('DRAFT');
  const messages = useOutreachMessages(organizationId, { status: status || undefined });

  return (
    <div className="dark -mx-4 -my-10 min-h-screen bg-ink-950 px-4 py-10 text-ink-50">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-ink-50">Aprovações de outreach</h1>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as OutreachStatus | '')}
            className={`${fieldClass} max-w-[280px]`}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {messages.isLoading && <p className="text-ink-500">Carregando mensagens…</p>}
        {messages.isSuccess && messages.data.length === 0 && (
          <p className="text-ink-500">Nenhuma mensagem de outreach nesse status.</p>
        )}

        {messages.isSuccess && messages.data.length > 0 && (
          <div className="rounded-lg border border-ink-700 bg-ink-900">
            <Table>
              <TableHeader>
                <TableRow className="border-ink-700 hover:bg-transparent">
                  <TableHead className="text-ink-300">Lead</TableHead>
                  <TableHead className="text-ink-300">Canal</TableHead>
                  <TableHead className="text-ink-300">Mensagem</TableHead>
                  <TableHead className="text-ink-300">Status</TableHead>
                  <TableHead className="text-ink-300">Criado em</TableHead>
                  <TableHead className="text-ink-300">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.data.map((message) => (
                  <QueueRow key={message.id} message={message} organizationId={organizationId} canWrite={canWrite} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
