import { buildIcs } from './build-ics';

describe('buildIcs', () => {
  const baseMeeting = {
    id: 'meeting-1',
    title: 'Reunião de fechamento',
    scheduledAt: new Date('2026-10-01T14:30:00.000Z'),
    durationMinutes: 30,
    location: null,
    notes: null,
  };

  it('gera um VCALENDAR/VEVENT válido com DTSTART/DTEND no formato UTC do iCalendar', () => {
    const ics = buildIcs(baseMeeting);

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:meeting-1@opsmind');
    expect(ics).toContain('DTSTART:20261001T143000Z');
    // 30 minutos depois
    expect(ics).toContain('DTEND:20261001T150000Z');
    expect(ics).toContain('SUMMARY:Reunião de fechamento');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('inclui LOCATION/DESCRIPTION só quando presentes', () => {
    const withExtras = buildIcs({ ...baseMeeting, location: 'Rua X, 100', notes: 'Levar proposta' });
    expect(withExtras).toContain('LOCATION:Rua X\\, 100');
    expect(withExtras).toContain('DESCRIPTION:Levar proposta');

    const without = buildIcs(baseMeeting);
    expect(without).not.toContain('LOCATION:');
    expect(without).not.toContain('DESCRIPTION:');
  });

  it('escapa vírgulas/ponto-e-vírgula/quebras de linha no texto (RFC 5545)', () => {
    const ics = buildIcs({ ...baseMeeting, notes: 'Linha 1\nLinha 2; ponto, vírgula' });
    expect(ics).toContain('DESCRIPTION:Linha 1\\nLinha 2\\; ponto\\, vírgula');
  });

  it('usa \\r\\n como separador de linha (exigido pelo RFC 5545)', () => {
    const ics = buildIcs(baseMeeting);
    expect(ics.split('\r\n').length).toBeGreaterThan(5);
  });
});
