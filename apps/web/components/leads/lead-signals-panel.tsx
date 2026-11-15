'use client';

import type { LeadSignal } from '@/lib/leads/types';
import { isSafeHttpUrl } from '@opsmind/shared-types';

interface LeadSignalsPanelProps {
  signals: LeadSignal[];
}

// Rótulo legível por código — mesma lista semeada em
// packages/database/prisma/migrations/20261106160000_lead_signals_and_signal_codes.
// Fallback pro próprio código quando um novo (proposto via `propose_signal_code`,
// Fase 5) ainda não tem rótulo mapeado aqui.
const SIGNAL_LABELS: Record<string, string> = {
  'website.no_ssl': 'Site sem HTTPS',
  'website.no_contact_form': 'Sem formulário de contato',
  'website.outdated_copyright_year': 'Ano de copyright desatualizado',
  'website.no_mobile_viewport': 'Sem viewport mobile configurado',
  'social.no_instagram': 'Sem perfil de Instagram encontrado',
  'social.no_whatsapp_link': 'Sem link de WhatsApp no site',
};

function confidenceLabel(confidence: string): string {
  const value = Number(confidence);
  if (!Number.isFinite(value)) return confidence;
  return `${Math.round(value * 100)}%`;
}

// Mesma linguagem visual do breakdown clicável de `LeadScoreBar` — lista
// simples de evidências, nunca uma conclusão pronta (ver restrição: um
// sinal é evidência, não uma oportunidade comercial automática).
export function LeadSignalsPanel({ signals }: LeadSignalsPanelProps) {
  if (signals.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum sinal detectado ainda — investigue o site do lead.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {signals.map((signal) => (
        <li key={signal.id} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-foreground">{SIGNAL_LABELS[signal.signalCode] ?? signal.signalCode}</span>
            <span className="text-xs text-muted-foreground">
              confiança {confidenceLabel(signal.confidence)} · {new Date(signal.observedAt).toLocaleDateString('pt-BR')}
            </span>
          </div>
          {signal.evidenceQuote && (
            <p className="mt-1 text-xs text-foreground/80">&ldquo;{signal.evidenceQuote}&rdquo;</p>
          )}
          {signal.evidenceUrl && isSafeHttpUrl(signal.evidenceUrl) && (
            <a
              href={signal.evidenceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-block text-xs text-accent-500 hover:underline"
            >
              ver evidência
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
