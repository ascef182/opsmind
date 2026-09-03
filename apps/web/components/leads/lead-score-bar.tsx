'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { LeadScoreBreakdown } from '@opsmind/shared-types';
import { Progress } from '@/components/ui/progress';

interface LeadScoreBarProps {
  breakdown: LeadScoreBreakdown;
}

// Traffic-light: mesmos limiares de `components/ai/budget-bar.tsx` (a
// analogia aqui é "quão saudável é este número", não orçamento) — verde ≥70,
// âmbar 40-69, cinza <40. Os valores em si são os do brief da Task 7, que
// batem com `QUALIFICATION_THRESHOLD` (50, packages/shared-types/src/lead-scoring.ts)
// caindo dentro da faixa âmbar — um lead "qualificado" não é necessariamente
// "verde" ainda.
// `indicatorClass` precisa ser a string COMPLETA e literal em cada branch —
// não construída por interpolação (`` `...${x}` ``) — porque o scanner
// estático do Tailwind v4 (sem tailwind.config.js, JIT puro sobre o texto-
// fonte) só gera CSS para tokens de classe que aparecem por inteiro, como
// substring contígua, em algum arquivo-fonte; uma classe montada em runtime
// por concatenação nunca existe como esse token completo no código-fonte e
// silenciosamente não vira CSS nenhum.
function scoreColor(total: number): { indicatorClass: string; text: string; label: string } {
  if (total >= 70) {
    return { indicatorClass: '[&>[data-slot=progress-indicator]]:bg-positive-500', text: 'text-positive-500', label: 'alto' };
  }
  if (total >= 40) {
    return { indicatorClass: '[&>[data-slot=progress-indicator]]:bg-accent-500', text: 'text-accent-500', label: 'médio' };
  }
  return { indicatorClass: '[&>[data-slot=progress-indicator]]:bg-ink-500', text: 'text-ink-500', label: 'baixo' };
}

const BREAKDOWN_ROWS: Array<{ key: keyof LeadScoreBreakdown; label: string }> = [
  { key: 'hasNoWebsitePoints', label: 'Sem site próprio' },
  { key: 'icpFitPoints', label: 'Fit com ICP (firmografia)' },
  { key: 'activityPoints', label: 'Atividade (rating/reviews)' },
  { key: 'keywordMatchPoints', label: 'Match de palavra-chave' },
];

// Reaproveita o padrão click-to-expand de `RequestTrace`
// (components/ai/ai-usage-panel.tsx): uma linha resumida, clicável, que
// revela um bloco de detalhe abaixo — aqui, o `scoreBreakdown` completo.
export function LeadScoreBar({ breakdown }: LeadScoreBarProps) {
  const [expanded, setExpanded] = useState(false);
  const { total } = breakdown;
  const { indicatorClass, text, label } = scoreColor(total);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        <Progress value={total} className={clsx('h-1.5 flex-1 bg-ink-800', indicatorClass)} />
        <span className={clsx('w-10 shrink-0 text-right text-xs font-medium tabular-nums', text)}>{total}</span>
      </button>
      {expanded && (
        <div className="rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-xs text-ink-300">
          <p className="mb-2">
            Score <span className={clsx('font-medium', text)}>{label}</span> — detalhamento:
          </p>
          <ul className="flex flex-col gap-1">
            {BREAKDOWN_ROWS.map(({ key, label: rowLabel }) => (
              <li key={key} className="flex justify-between">
                <span>{rowLabel}</span>
                <span className="tabular-nums text-ink-50">{breakdown[key] as number} pts</span>
              </li>
            ))}
            <li className="mt-1 flex justify-between border-t border-ink-700 pt-1 font-medium">
              <span className="text-ink-50">Total</span>
              <span className={clsx('tabular-nums', text)}>{total} pts</span>
            </li>
          </ul>
          {breakdown.matchedSignals.length > 0 && (
            <div className="mt-2">
              <p className="text-ink-500">Sinais que bateram:</p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {breakdown.matchedSignals.map((signal) => (
                  <li key={signal} className="rounded bg-ink-800 px-1.5 py-0.5 text-ink-50">
                    {signal}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
