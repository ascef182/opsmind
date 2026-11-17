const FORMATTER = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return FORMATTER.format(diffSeconds, 'second');
  if (abs < 3600) return FORMATTER.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86_400) return FORMATTER.format(Math.round(diffSeconds / 3600), 'hour');
  return FORMATTER.format(Math.round(diffSeconds / 86_400), 'day');
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
