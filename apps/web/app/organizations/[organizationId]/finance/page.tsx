'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAnnualReport, useFinanceOverview } from '@/lib/finance/use-finance';
import { FINANCIAL_CATEGORY_LABELS } from '@opsmind/shared-types';
import { brl, currentMonthKey, fmtDate, fmtMonth, shiftMonth } from '@/lib/finance/format';
import type { CategoryTotal, DueSoonItem } from '@/lib/finance/types';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SparklineChart } from '@/components/ui/chart-card';
import { EmptyState, Kpi } from '@/components/finance/finance-ui';

function CategoryList({ title, rows, empty }: { title: string; rows: CategoryTotal[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.category} className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-2">
                <span>{FINANCIAL_CATEGORY_LABELS[row.category]}</span>
                <span className="tabular-nums">{brl(row.cents)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-ink-800">
                <div className="h-1.5 rounded-full bg-accent-500" style={{ width: `${(row.cents / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DueList({ title, items, empty, href }: { title: string; items: DueSoonItem[]; empty: string; href: string }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <Link href={href} className="text-xs text-accent-500 hover:underline">
          Ver todos
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate">{item.description}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.counterparty ? `${item.counterparty} · ` : ''}
                  <span className={item.overdue ? 'text-negative-500' : undefined}>
                    {item.overdue ? 'venceu em ' : 'vence em '}
                    {fmtDate(item.dueDate)}
                  </span>
                </p>
              </div>
              <span className="whitespace-nowrap tabular-nums">{brl(item.outstandingCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function FinanceOverviewPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const overview = useFinanceOverview(organizationId, month);
  // Tendência do "Recebida" dentro do ano corrente do mês selecionado — não
  // cruza a virada de ano (ex.: em janeiro mostra só janeiro), simplificação
  // deliberada para não precisar buscar dois anos e juntar.
  const annual = useAnnualReport(organizationId, Number(month.slice(0, 4)));
  const sparklineData = (annual.data?.months ?? [])
    .filter((m) => m.month <= month)
    .map((m) => ({ value: m.receivedCents }));
  const base = `/organizations/${organizationId}/finance`;

  const data = overview.data;
  const hasAnyData =
    data &&
    (data.summary.contractedCents > 0 ||
      data.summary.invoicedCents > 0 ||
      data.summary.receivedCents > 0 ||
      data.summary.expensesPaidCents > 0 ||
      data.summary.expensesAccruedCents > 0 ||
      data.balances.receivableOpenCents > 0 ||
      data.balances.payableOpenCents > 0 ||
      data.mrrCents > 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior">
          ←
        </Button>
        <span className="min-w-24 text-center text-sm font-medium">{fmtMonth(month)}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setMonth(shiftMonth(month, 1))}
          aria-label="Próximo mês"
        >
          →
        </Button>
        {month !== thisMonth && (
          <Button variant="ghost" size="sm" onClick={() => setMonth(thisMonth)}>
            Mês atual
          </Button>
        )}
      </div>

      {overview.isLoading && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {overview.isError && (
        <FormError message={overview.error instanceof ApiError ? overview.error.message : 'Não foi possível carregar o financeiro.'} />
      )}

      {data && (
        <>
          {!hasAnyData && (
            <EmptyState
              title="Nenhum dado financeiro neste mês"
              description="Cadastre um contrato para prever a receita, ou lance uma receita ou despesa. Os números aparecem aqui assim que houver movimentação."
              action={{ label: 'Criar um contrato', href: `${base}/contracts` }}
            />
          )}

          <section aria-label="Receita" className="flex flex-col gap-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Receita do mês</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Contratada" value={brl(data.summary.contractedCents)} hint="o que os contratos preveem" />
              <Kpi label="Faturada" value={brl(data.summary.invoicedCents)} hint="cobranças emitidas" />
              <Kpi
                label="Recebida"
                value={brl(data.summary.receivedCents)}
                tone="positive"
                hint="dinheiro que entrou"
                chart={sparklineData.length > 1 ? <SparklineChart data={sparklineData} dataKey="value" color="#22c55e" /> : undefined}
              />
              <Kpi label="MRR" value={brl(data.mrrCents)} hint={`${data.activeContracts} contrato(s) ativo(s)`} />
            </div>
          </section>

          <section aria-label="Caixa" className="flex flex-col gap-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Caixa e resultado</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Despesas pagas" value={brl(data.summary.expensesPaidCents)} />
              <Kpi
                label="Resultado realizado"
                value={brl(data.summary.resultCents)}
                tone={data.summary.resultCents < 0 ? 'negative' : data.summary.resultCents > 0 ? 'positive' : 'default'}
                hint="recebido − taxas − despesas pagas"
              />
              <Kpi
                label="A receber (em aberto)"
                value={brl(data.balances.receivableOpenCents)}
                hint={`${brl(data.balances.receivableOverdueCents)} vencido`}
                tone={data.balances.receivableOverdueCents > 0 ? 'negative' : 'default'}
              />
              <Kpi
                label="A pagar (em aberto)"
                value={brl(data.balances.payableOpenCents)}
                hint={`${brl(data.balances.payableOverdueCents)} vencido`}
                tone={data.balances.payableOverdueCents > 0 ? 'negative' : 'default'}
              />
            </div>
          </section>

          {data.wonDealsWithoutContract.length > 0 && (
            <Card className="flex flex-col gap-2 border-accent-500/40 p-4">
              <h2 className="text-sm font-medium">Negócios ganhos sem contrato</h2>
              <p className="text-xs text-muted-foreground">
                Esses negócios foram fechados mas ainda não geram receita prevista. Abra o negócio e gere o contrato.
              </p>
              <ul className="flex flex-col divide-y divide-border">
                {data.wonDealsWithoutContract.map((deal) => (
                  <li key={deal.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/organizations/${organizationId}/deals/${deal.id}`} className="hover:text-accent-400">
                      {deal.title} <span className="text-muted-foreground">· {deal.customerName}</span>
                    </Link>
                    <span className="tabular-nums">{brl(deal.valueCents)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <DueList
              title="Próximos recebimentos"
              items={data.upcomingReceivables}
              empty="Nada a receber em aberto."
              href={`${base}/entries?direction=INCOME&status=PENDING`}
            />
            <DueList
              title="Próximos pagamentos"
              items={data.upcomingPayables}
              empty="Nenhuma conta a pagar em aberto."
              href={`${base}/entries?direction=EXPENSE&status=PENDING`}
            />
            <CategoryList title="Receita recebida por categoria" rows={data.incomeByCategory} empty="Nenhum recebimento no mês." />
            <CategoryList title="Despesas pagas por categoria" rows={data.expensesByCategory} empty="Nenhuma despesa paga no mês." />
          </div>

          <section aria-label="Conta pessoal" className="flex flex-col gap-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Conta pessoal</h2>
            <p className="text-xs text-muted-foreground">
              Lançamentos marcados como pessoais — nunca somados aos números da empresa (CNPJ) acima.
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Recebido (pessoal)" value={brl(data.personal.summary.receivedCents)} tone="positive" />
              <Kpi label="Pago (pessoal)" value={brl(data.personal.summary.expensesPaidCents)} />
            </div>
            {data.personal.incomeByCategory.length > 0 && (
              <CategoryList
                title="Receita pessoal por categoria"
                rows={data.personal.incomeByCategory}
                empty="Nenhum recebimento pessoal no mês."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
