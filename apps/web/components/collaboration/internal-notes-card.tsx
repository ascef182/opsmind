'use client';

import { useState } from 'react';
import { useMembers } from '@/lib/memberships/use-memberships';
import type { CreateNoteInput, InternalNote } from '@/lib/collaboration/types';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, FormError } from '@/components/ui/card';

interface InternalNotesCardProps {
  organizationId: string;
  notes: InternalNote[] | undefined;
  isLoading: boolean;
  canWrite: boolean;
  onCreate: (input: CreateNoteInput) => void;
  isCreating: boolean;
  createError: unknown;
}

/**
 * Notas internas de equipe (Trilha B, plano
 * pensando-como-empresa-com-agile-beaver.md) — mesmo componente usado na
 * tela de Deal e na de Lead (UI idêntica, só muda de onde vêm as notas e
 * pra onde a mutation escreve; ver `use-internal-notes.ts`). Menção por
 * seleção explícita de membro (chips clicáveis), não parsing de "@nome" em
 * texto livre — mesmo racional do backend.
 */
export function InternalNotesCard({
  organizationId,
  notes,
  isLoading,
  canWrite,
  onCreate,
  isCreating,
  createError,
}: InternalNotesCardProps) {
  const members = useMembers(organizationId);
  const [body, setBody] = useState('');
  const [mentioned, setMentioned] = useState<string[]>([]);

  const memberName = (userId: string) => members.data?.find((m) => m.userId === userId)?.user.name ?? 'alguém';

  return (
    <Card>
      <h2 className="font-medium text-foreground">Notas internas</h2>
      <p className="text-xs text-muted-foreground">Visível só pra equipe — nunca pro cliente.</p>

      {canWrite && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            onCreate({ body, mentionedUserIds: mentioned.length > 0 ? mentioned : undefined });
            setBody('');
            setMentioned([]);
          }}
        >
          <Textarea
            rows={3}
            placeholder="Escreva uma nota interna…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {members.data && members.data.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Mencionar:</span>
              {members.data.map((member) => (
                <button
                  key={member.userId}
                  type="button"
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    mentioned.includes(member.userId)
                      ? 'bg-accent-500/15 text-accent-400'
                      : 'bg-ink-800 text-muted-foreground'
                  }`}
                  onClick={() =>
                    setMentioned((prev) =>
                      prev.includes(member.userId)
                        ? prev.filter((id) => id !== member.userId)
                        : [...prev, member.userId],
                    )
                  }
                >
                  {member.user.name}
                </button>
              ))}
            </div>
          )}
          <FormError message={createError ? (createError as ApiError).message : null} />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isCreating || !body.trim()}>
              {isCreating ? 'Salvando…' : 'Adicionar nota'}
            </Button>
          </div>
        </form>
      )}

      {isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando notas…</p>}
      {notes && notes.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">Nenhuma nota interna ainda.</p>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {notes?.map((note) => (
          <li key={note.id} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">{memberName(note.authorUserId)}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(note.createdAt).toLocaleString('pt-BR')}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-foreground/80">{note.body}</p>
            {note.mentionedUserIds.length > 0 && (
              <p className="mt-1 text-xs text-accent-400">
                Mencionou: {note.mentionedUserIds.map(memberName).join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
