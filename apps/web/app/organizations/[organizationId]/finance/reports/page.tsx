'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { FINANCIAL_CATEGORY_LABELS } from '@opsmind/shared-types';
import { useAnnualReport, useProfitability } from '@/lib/finance/use-finance';
import { brl, currentMonthKey, fmtMonth } from '@/lib/finance/format';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { DonutChart, LineChartWithTooltip } from '@/components/ui/chart-card';
import { EmptyState, Kpi } from '@/components/finance/finance-ui';
import type { CategoryTotal } from '@/lib/finance/types';

const errorText = (e: unknown, fallback: string) =>
  e instanceof ApiError || e instanceof Error ? e.message : fallback;
const tone = (cents: number) => (cents < 0 ? 'text-negative-500' : '');

// Teto anual padrão do MEI (receita bruta, não faturamento contratado) —
// ajuste aqui se a sua faixa de MEI for diferente ou a lei mudar.
const MEI_ANNUAL_LIMIT_CENTS = 81_000_00;

// Skeleton de página inteira — só pra PRIMEIRA carga (sem nenhum dado ainda
// pra `annual` nem `profit`). Depois que os dois carregarem uma vez, cada
// seção volta a usar seu próprio isLoading/isError (trocar o seletor de ano
// ou de cliente/contrato não deve apagar a página inteira de novo).
function ReportsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-56" />
      <Skeleton className="h-64" />
      <Skeleton className="h-32" />
    </div>
  );
}

function Categories({ title, rows }: { title: string; rows: CategoryTotal[] }) {
  // Mesmo motivo do gráfico de linha acima: tooltip do recharts mostra o
  // valor bruto, sem formatador de moeda — em reais inteiros, não centavos.
  const donutData = rows.map((r) => ({
    name: FINANCIAL_CATEGORY_LABELS[r.category],
    value: Math.round(r.cents / 100),
  }));
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem movimentação no ano.</p>
      ) : (
        <>
          <DonutChart data={donutData} height={160} />
          <ul className="flex flex-col divide-y divide-border text-sm">
            {rows.map((r) => (
              <li key={r.category} className="flex justify-between py-1.5">
                <span>{FINANCIAL_CATEGORY_LABELS[r.category]}</span>
                <span className="tabular-nums">{brl(r.cents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export default function ReportsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const thisYear = Number(currentMonthKey().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [by, setBy] = useState<'customer' | 'contract'>('customer');
  const annual = useAnnualReport(organizationId, year);
  const profit = useProfitability(organizationId, by, {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  });
  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];
  const firstLoad = (annual.isLoading || profit.isLoading) && !annual.data && !profit.data;

  const hasData =
    annual.data &&
    (annual.data.totals.receivedCents > 0 ||
      annual.data.totals.expensesPaidCents > 0 ||
      annual.data.totals.contractedCents > 0 ||
      annual.data.totals.invoicedCents > 0);

  return (
    <div className="flex flex-col gap-6 print:gap-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Select
          className="w-32"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Ano"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <Button className="ml-auto" variant="secondary" onClick={() => window.print()}>
          Imprimir / salvar PDF
        </Button>
      </div>

      {firstLoad ? (
        <ReportsSkeleton />
      ) : (
        <>
          {annual.isLoading && <Skeleton className="h-64" />}
          {annual.isError && (
            <FormError
              message={errorText(annual.error, 'Não foi possível carregar o relatório.')}
            />
          )}

          {annual.data && !hasData && (
            <EmptyState
              title={`Sem movimentação financeira em ${year}`}
              description="Quando houver contratos, recebimentos ou despesas neste ano, o relatório mensal, trimestral e anual aparece aqui."
            />
          )}

          {annual.data && hasData && (
            <>
              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi
                  label={`Contratada em ${year}`}
                  value={brl(annual.data.totals.contractedCents)}
                />
                <Kpi label="Faturada" value={brl(annual.data.totals.invoicedCents)} />
                <Kpi
                  label="Recebida"
                  value={brl(annual.data.totals.receivedCents)}
                  tone="positive"
                />
                <Kpi
                  label="Resultado realizado"
                  value={brl(annual.data.totals.resultCents)}
                  tone={annual.data.totals.resultCents < 0 ? 'negative' : 'default'}
                  hint="recebido − taxas − despesas pagas"
                />
                <Kpi
                  label="Faturamento anual (MEI)"
                  value={brl(annual.data.totals.receivedCents)}
                  tone={
                    annual.data.totals.receivedCents >= MEI_ANNUAL_LIMIT_CENTS * 0.9
                      ? 'negative'
                      : 'default'
                  }
                  hint={`${((annual.data.totals.receivedCents / MEI_ANNUAL_LIMIT_CENTS) * 100).toFixed(1)}% do teto de ${brl(MEI_ANNUAL_LIMIT_CENTS)}`}
                />
              </section>

              <Card className="p-4 print:hidden">
                <h3 className="mb-3 text-sm font-medium">Recebido mês a mês em {year}</h3>
                {/* Recharts mostra o valor bruto no tooltip (sem formatador de moeda,
                mesmo padrão de revenueChartData no dashboard) — por isso em reais
                inteiros, não centavos, senão o tooltip mostraria 100x o valor. */}
                <LineChartWithTooltip
                  data={annual.data.months.map((m) => ({
                    month: fmtMonth(m.month),
                    recebidoReais: Math.round(m.receivedCents / 100),
                  }))}
                  dataKey="recebidoReais"
                  xKey="month"
                  highlightLast
                />
              </Card>

              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <caption className="px-4 pt-4 text-left text-sm font-medium">
                    Evolução mensal
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Mês</th>
                      <th className="px-4 py-2 text-right font-medium">Contratada</th>
                      <th className="px-4 py-2 text-right font-medium">Faturada</th>
                      <th className="px-4 py-2 text-right font-medium">Recebida</th>
                      <th className="px-4 py-2 text-right font-medium">Despesas pagas</th>
                      <th className="px-4 py-2 text-right font-medium">Resultado</th>
                      <th className="px-4 py-2 text-right font-medium">A receber</th>
                      <th className="px-4 py-2 text-right font-medium">A pagar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {annual.data.months.map((m) => (
                      <tr key={m.month} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">{fmtMonth(m.month)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl(m.contractedCents)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl(m.invoicedCents)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl(m.receivedCents)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl(m.expensesPaidCents)}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${tone(m.resultCents)}`}>
                          {brl(m.resultCents)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {brl(m.expectedInCents)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {brl(m.expectedOutCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-4 pb-3 pt-1 text-xs text-muted-foreground">
                  “A receber / A pagar” = o que vence no mês e ainda não foi quitado (fluxo de caixa
                  esperado).
                </p>
              </Card>

              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <caption className="px-4 pt-4 text-left text-sm font-medium">Trimestres</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Trimestre</th>
                      <th className="px-4 py-2 text-right font-medium">Contratada</th>
                      <th className="px-4 py-2 text-right font-medium">Recebida</th>
                      <th className="px-4 py-2 text-right font-medium">Despesas pagas</th>
                      <th className="px-4 py-2 text-right font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {annual.data.quarters.map((q) => (
                      <tr key={q.quarter} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">{q.quarter}º tri</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl(q.contractedCents)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl(q.receivedCents)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl(q.expensesPaidCents)}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${tone(q.resultCents)}`}>
                          {brl(q.resultCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Categories title="Receita por categoria" rows={annual.data.incomeByCategory} />
                <Categories title="Despesas por categoria" rows={annual.data.expensesByCategory} />
              </div>

              {(annual.data.personal.summary.receivedCents > 0 ||
                annual.data.personal.summary.expensesPaidCents > 0) && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-sm font-medium">
                    Pessoal em {year}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      (fora do resultado da empresa)
                    </span>
                  </h2>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                    <Kpi
                      label="Recebido"
                      value={brl(annual.data.personal.summary.receivedCents)}
                      tone="positive"
                    />
                    <Kpi label="Pago" value={brl(annual.data.personal.summary.expensesPaidCents)} />
                    <Kpi
                      label="Resultado"
                      value={brl(annual.data.personal.summary.resultCents)}
                      tone={annual.data.personal.summary.resultCents < 0 ? 'negative' : 'default'}
                    />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Categories
                      title="Receita pessoal por categoria"
                      rows={annual.data.personal.incomeByCategory}
                    />
                    <Categories
                      title="Despesa pessoal por categoria"
                      rows={annual.data.personal.expensesByCategory}
                    />
                  </div>
                </section>
              )}

              {annual.data.topCustomers.length > 0 && (
                <Card className="flex flex-col gap-2 p-4">
                  <h3 className="text-sm font-medium">Clientes que mais pagaram</h3>
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {annual.data.topCustomers.map((c) => (
                      <li key={c.customerId ?? 'none'} className="flex justify-between py-1.5">
                        <span>{c.customerName}</span>
                        <span className="tabular-nums">{brl(c.receivedCents)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}

          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">Rentabilidade em {year}</h2>
              <Select
                className="w-40 print:hidden"
                value={by}
                onChange={(e) => setBy(e.target.value as 'customer' | 'contract')}
                aria-label="Agrupar por"
              >
                <option value="customer">Por cliente</option>
                <option value="contract">Por contrato</option>
              </Select>
            </div>
            {profit.isLoading && <Skeleton className="h-32" />}
            {profit.isError && (
              <FormError
                message={errorText(profit.error, 'Não foi possível carregar a rentabilidade.')}
              />
            )}
            {profit.data && profit.data.rows.length === 0 && (
              <EmptyState
                title="Sem dados de rentabilidade"
                description="Aparece quando houver receita ou custo vinculado a clientes ou contratos no ano."
              />
            )}
            {profit.data && profit.data.rows.length > 0 && (
              <Card className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">
                        {by === 'customer' ? 'Cliente' : 'Contrato'}
                      </th>
                      <th className="px-4 py-2 text-right font-medium">Contratada</th>
                      <th className="px-4 py-2 text-right font-medium">Recebida</th>
                      <th className="px-4 py-2 text-right font-medium">Em aberto</th>
                      <th className="px-4 py-2 text-right font-medium">Custos + taxas</th>
                      <th className="px-4 py-2 text-right font-medium">Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profit.data.rows.map((r) => (
                      <tr key={r.key ?? 'none'} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">
                          {r.label}
                          {r.sublabel && (
                            <p className="text-xs text-muted-foreground">{r.sublabel}</p>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl(r.contractedCents)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl(r.receivedCents)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{brl(r.openCents)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {brl(r.costsCents + r.feesCents)}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${tone(r.marginCents)}`}>
                          {brl(r.marginCents)}
                          {r.marginPct !== null && (
                            <span className="text-xs text-muted-foreground">
                              {' '}
                              ({r.marginPct.toFixed(0)}%)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
