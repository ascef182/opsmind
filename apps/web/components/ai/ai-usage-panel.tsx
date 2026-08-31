'use client';

import { useState } from 'react';
import { useAiRequests, useAiUsage, type DailyUsagePoint } from '@/lib/ai/use-ai-chat';
import { useUpdateAiBudget } from '@/lib/organizations/use-organizations';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, FormError } from '@/components/ui/card';
import { BudgetBar } from './budget-bar';

function DailyChart({ series }: { series: DailyUsagePoint[] }) {
  if (series.length === 0) {
    return <p className="text-sm text-slate-400">Sem uso registrado este mês ainda.</p>;
  }
  const max = Math.max(...series.map((p) => p.cost), 0.0001);
  const barWidth = 24;
  return (
    <svg
      viewBox={`0 0 ${series.length * barWidth} 60`}
      className="h-16 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Custo diário de IA este mês"
    >
      {series.map((point, i) => {
        const height = (point.cost / max) * 56;
        return (
          <rect
            key={point.date}
            x={i * barWidth + 4}
            y={60 - height}
            width={16}
            height={Math.max(height, 1)}
            rx={2}
            className="fill-brand-500"
          >
            <title>{`${point.date}: $${point.cost.toFixed(4)} (${point.requests} requests)`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function RequestTrace({ organizationId }: { organizationId: string }) {
  const requests = useAiRequests(organizationId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (requests.isLoading) return <p className="text-sm text-slate-500">Carregando…</p>;
  if (!requests.data || requests.data.length === 0) {
    return <p className="text-sm text-slate-400">Nenhuma conversa com a IA ainda.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {requests.data.map((req) => (
        <div key={req.id} className="rounded-md border border-slate-200">
          <button
            type="button"
            onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
          >
            <span className="text-slate-700">
              {new Date(req.createdAt).toLocaleString('pt-BR')} — {req.userName}
            </span>
            <span className="text-xs text-slate-400">
              ${req.estimatedCost.toFixed(4)} · {req.latencyMs}ms · {req.toolCalls.length} tool
              {req.toolCalls.length === 1 ? '' : 's'}
            </span>
          </button>
          {expandedId === req.id && (
            <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
              {req.toolCalls.length === 0 ? (
                <p>Nenhuma tool chamada — resposta direta.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {req.toolCalls.map((call, i) => (
                    <li key={i}>
                      <p className={call.isError ? 'font-medium text-red-700' : 'font-medium text-slate-800'}>
                        {call.toolName}
                        {call.isError && ' (erro)'}
                      </p>
                      <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2">
                        {JSON.stringify(call.input, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function AiUsagePanel({
  organizationId,
  canManageBudget,
}: {
  organizationId: string;
  canManageBudget: boolean;
}) {
  const usage = useAiUsage(organizationId);
  const updateBudget = useUpdateAiBudget(organizationId);
  const [budgetInput, setBudgetInput] = useState('');

  const onSubmitBudget = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = budgetInput.trim();
    updateBudget.mutate(trimmed === '' ? null : Number(trimmed), {
      onSuccess: () => setBudgetInput(''),
    });
  };

  if (usage.isLoading) return <p className="text-slate-500">Carregando uso de IA…</p>;
  if (!usage.data) return <p className="text-red-700">Não foi possível carregar o uso de IA desta organização.</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <BudgetBar monthSpend={usage.data.monthSpend} monthlyBudget={usage.data.monthlyBudget} />
        <p className="mt-1 text-xs text-slate-400">
          {usage.data.totalRequests} requests · {usage.data.avgLatencyMs.toFixed(0)}ms médio
        </p>
        {canManageBudget && (
          <form onSubmit={onSubmitBudget} className="mt-3 flex items-center gap-2">
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="orçamento mensal (vazio = sem limite)"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              className="max-w-xs"
            />
            <Button type="submit" variant="secondary" isLoading={updateBudget.isPending}>
              Salvar
            </Button>
          </form>
        )}
        <FormError message={updateBudget.isError ? (updateBudget.error as ApiError).message : null} />
      </Card>

      <Card>
        <h2 className="mb-2 font-medium text-slate-900">Custo diário este mês</h2>
        <DailyChart series={usage.data.dailySeries} />
      </Card>

      {usage.data.byUser.length > 0 && (
        <Card>
          <h2 className="mb-2 font-medium text-slate-900">Por usuário</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {usage.data.byUser.map((u) => (
              <li key={u.userId} className="flex justify-between">
                <span className="text-slate-700">{u.name}</span>
                <span className="text-slate-400">
                  ${u.cost.toFixed(4)} · {u.requests} requests
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="mb-2 font-medium text-slate-900">Conversas recentes</h2>
        <RequestTrace organizationId={organizationId} />
      </Card>
    </div>
  );
}
