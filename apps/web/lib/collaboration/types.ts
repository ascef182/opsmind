// Espelha o model InternalNote de apps/api (@opsmind/database) — mesma
// decisão de tipos duplicados ao front que o resto de lib/*/types.ts.
export interface InternalNote {
  id: string;
  dealId: string | null;
  leadId: string | null;
  body: string;
  // Menção por seleção explícita, não parsing de "@nome" em texto livre —
  // ver comentário de InternalNotesService no backend.
  mentionedUserIds: string[];
  authorUserId: string;
  createdAt: string;
}

export interface CreateNoteInput {
  body: string;
  mentionedUserIds?: string[];
}
