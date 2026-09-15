// Espelha o model Meeting de apps/api (@opsmind/database) — mesma decisão
// de tipos duplicados ao front que o resto de lib/*/types.ts.
export interface Meeting {
  id: string;
  organizationId: string;
  dealId: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  location: string | null;
  notes: string | null;
  reminderNotifiedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMeetingInput {
  title: string;
  scheduledAt: string;
  durationMinutes?: number;
  location?: string;
  notes?: string;
}

export interface UpdateMeetingInput {
  title?: string;
  scheduledAt?: string;
  durationMinutes?: number;
  location?: string;
  notes?: string;
}

// Link "quick add" público do Google Calendar — sem OAuth, sem token nosso
// envolvido: só abre uma página de criação de evento pré-preenchida na
// conta Google de quem clicar, que confirma/edita e salva por conta própria
// (ver comentário no schema.prisma sobre por que não usamos a API real do
// Google Calendar aqui).
export function buildGoogleCalendarUrl(meeting: Meeting): string {
  const start = new Date(meeting.scheduledAt);
  const end = new Date(start.getTime() + meeting.durationMinutes * 60_000);
  const formatDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: meeting.title,
    dates: `${formatDate(start)}/${formatDate(end)}`,
  });
  if (meeting.location) params.set('location', meeting.location);
  if (meeting.notes) params.set('details', meeting.notes);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
