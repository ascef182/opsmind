export interface IcsMeetingInput {
  id: string;
  title: string;
  scheduledAt: Date;
  durationMinutes: number;
  location: string | null;
  notes: string | null;
}

// Formato exigido pelo RFC 5545 para datas UTC: YYYYMMDDTHHMMSSZ.
function formatIcsDate(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

// Escapa vírgula/ponto-e-vírgula/barra invertida/quebra de linha — RFC 5545
// §3.3.11. A ordem importa: a barra invertida tem que ser escapada primeiro,
// senão as barras inseridas pelos escapes seguintes seriam escapadas de novo.
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Gera um arquivo .ics (RFC 5545) pra uma reunião — pra qualquer app de
 * calendário além do Google (que usa o link "quick add" gerado no frontend,
 * sem precisar deste arquivo). Função pura, sem I/O — `MeetingsController`
 * só serve o resultado com `Content-Type: text/calendar`.
 */
export function buildIcs(meeting: IcsMeetingInput): string {
  const end = new Date(meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpsMind//Meetings//PT',
    'BEGIN:VEVENT',
    `UID:${meeting.id}@opsmind`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(meeting.scheduledAt)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(meeting.title)}`,
    meeting.location ? `LOCATION:${escapeIcsText(meeting.location)}` : null,
    meeting.notes ? `DESCRIPTION:${escapeIcsText(meeting.notes)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.filter((line): line is string => line !== null).join('\r\n');
}
