'use client';

import { useState } from 'react';
import { useAiRequests, useAiUsage } from '@/lib/ai/use-ai-chat';
import { useUpdateAiBudget } from '@/lib/organizations/use-organizations';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, FormError } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LineChartWithTooltip } from '@/components/ui/chart-card';
import { BudgetBar } from './budget-bar';

function RequestTrace({ organizationId }: { organizationId: string }) {
  const requests = useAiRequests(organizationId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (requests.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (!requests.data || requests.data.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma conversa com a IA ainda.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {requests.data.map((req) => (
        <div key={req.id} className="rounded-md border border-border">
          <button
            type="button"
            onClick={() => setExpandedId(expandedId === req.id ? null : req.id)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
          >
            <span className="text-foreground/80">
              {new Date(req.createdAt).toLocaleString('pt-BR')} — {req.userName}
            </span>
            <span className="text-xs text-muted-foreground">
              ${req.estimatedCost.toFixed(4)} · {req.latencyMs}ms · {req.toolCalls.length} tool
              {req.toolCalls.length === 1 ? '' : 's'}
            </span>
          </button>
          {expandedId === req.id && (
            <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {req.toolCalls.length === 0 ? (
                <p>Nenhuma tool chamada — resposta direta.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {req.toolCalls.map((call, i) => (
                    <li key={i}>
                      <p className="flex items-center gap-2 font-medium text-foreground/80">
                        {call.toolName}
                        {call.isError && (
                          <span className="rounded-full bg-negative-500/15 px-2 py-0.5 text-[10px] font-medium text-negative-500">
                            erro
                          </span>
                        )}
                      </p>
                      <pre className="mt-1 overflow-x-auto rounded bg-ink-800 p-2 font-mono text-[11px] leading-relaxed text-foreground/70">
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

  if (usage.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!usage.data) return <p className="text-destructive">Não foi possível carregar o uso de IA desta organização.</p>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Orçamento</CardTitle>
        </CardHeader>
        <CardContent>
          <BudgetBar monthSpend={usage.data.monthSpend} monthlyBudget={usage.data.monthlyBudget} />
          <p className="mt-1 text-xs text-muted-foreground">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custo diário este mês</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.data.dailySeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem uso registrado este mês ainda.</p>
          ) : (
            <>
              <LineChartWithTooltip
                data={usage.data.dailySeries.map((p) => ({ date: p.date, cost: p.cost }))}
                dataKey="cost"
                xKey="date"
                height={200}
              />
              <p className="mt-2 text-xs text-muted-foreground">{usage.data.totalRequests} requests este mês</p>
            </>
          )}
        </CardContent>
      </Card>

      {usage.data.byUser.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Por usuário</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Usuário</TableHead>
                  <TableHead>Requests</TableHead>
                  <TableHead>Custo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.data.byUser.map((u) => (
                  <TableRow key={u.userId}>
                    <TableCell className="text-foreground/80">{u.name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.requests}</TableCell>
                    <TableCell className="text-muted-foreground">${u.cost.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Conversas recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <RequestTrace organizationId={organizationId} />
        </CardContent>
      </Card>
    </div>
  );
}
