'use client';

import { useState } from 'react';
import { DEAL_STAGE_LABELS, formatCurrency } from '@/lib/deals/types';
import type { WeightedPipelineStageBucket } from '@/lib/dashboard/use-dashboard';

interface ForecastBreakdownProps {
  weightedPipelineValue: number;
  weightedPipelineByStage: WeightedPipelineStageBucket[];
}

// Mesmo padrão click-to-expand de `LeadScoreBar`
// (components/leads/lead-score-bar.tsx) — aqui pra "Pipeline ponderado" do
// dashboard, que antes só mostrava o número final sem nenhuma forma de
// verificar a conta (achado real, 2026-09: usuário não entendia de onde
// vinha R$1.050,00).
export function ForecastBreakdown({ weightedPipelineValue, weightedPipelineByStage }: ForecastBreakdownProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">Pipeline ponderado</p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 flex w-full items-baseline justify-between gap-2 text-left"
        aria-expanded={expanded}
      >
        <span className="text-3xl font-semibold text-foreground">{formatCurrency(weightedPipelineValue)}</span>
        <span className="shrink-0 text-xs text-accent-400 hover:underline">{expanded ? 'ocultar cálculo' : 'ver cálculo'}</span>
      </button>
      <p className="mt-1 text-xs text-muted-foreground">
        valor em aberto ajustado pela probabilidade de cada estágio — estimativa inicial, ainda não calibrada com o
        histórico de fechamento desta organização
      </p>
      {expanded && (
        <div className="mt-3 rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-xs text-ink-300">
          {weightedPipelineByStage.length === 0 ? (
            <p>Nenhum negócio aberto no momento.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {weightedPipelineByStage.map((bucket) => (
                <li key={bucket.stage} className="flex items-center justify-between gap-2">
                  <span className="text-ink-50">
                    {DEAL_STAGE_LABELS[bucket.stage]}{' '}
                    <span className="text-ink-500">
                      ({bucket.dealCount} · {formatCurrency(bucket.openValue)} × {Math.round(bucket.probability * 100)}%)
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-50">{formatCurrency(bucket.weightedValue)}</span>
                </li>
              ))}
              <li className="mt-1 flex justify-between border-t border-ink-700 pt-1 font-medium">
                <span className="text-ink-50">Total ponderado</span>
                <span className="tabular-nums text-accent-400">{formatCurrency(weightedPipelineValue)}</span>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
