'use client';

import Link from 'next/link';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useFinanceOverview } from '@/lib/finance/use-finance';
import { FINANCE_READ_ROLES } from '@/lib/finance/types';
import { brl, fmtMonth } from '@/lib/finance/format';

function Stat({ label, value, hint, negative }: { label: string; value: string; hint?: string; negative?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${negative ? 'text-negative-500' : 'text-foreground'}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Bloco financeiro do dashboard. Só para quem pode ver o Financeiro
 * (MANAGER+): para os demais papéis nem dispara a consulta e não renderiza nada.
 */
export function FinanceSnapshotSection({ organizationId }: { organizationId: string }) {
  const { membership } = useCurrentMembership(organizationId);
  const allowed = membership ? FINANCE_READ_ROLES.includes(membership.role) : false;
  const overview = useFinanceOverview(organizationId, undefined, allowed);

  if (!allowed) return null;
  const base = `/organizations/${organizationId}/finance`;
  const data = overview.data;

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Financeiro{data ? ` · ${fmtMonth(data.period.from.slice(0, 7))}` : ''}</h2>
        <Link href={base} className="text-xs text-accent-500 hover:underline">
          Abrir financeiro
        </Link>
      </div>
      {overview.isLoading && <p className="text-muted-foreground">Carregando financeiro…</p>}
      {overview.isError && <p className="text-negative-500">Não foi possível carregar o financeiro desta organização.</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Receita contratada" value={brl(data.summary.contractedCents)} hint={`${data.activeContracts} contrato(s) ativo(s)`} />
            <Stat label="Recebido no mês" value={brl(data.summary.receivedCents)} hint={`faturado ${brl(data.summary.invoicedCents)}`} />
            <Stat label="MRR" value={brl(data.mrrCents)} hint="receita recorrente mensal" />
            <Stat
              label="Resultado do mês"
              value={brl(data.summary.resultCents)}
              negative={data.summary.resultCents < 0}
              hint={`despesas pagas ${brl(data.summary.expensesPaidCents)}`}
            />
            <Stat
              label="A receber vencido"
              value={brl(data.balances.receivableOverdueCents)}
              negative={data.balances.receivableOverdueCents > 0}
              hint={`${data.balances.receivableOverdueCount} cobrança(s) · em aberto ${brl(data.balances.receivableOpenCents)}`}
            />
            <Stat
              label="A pagar vencido"
              value={brl(data.balances.payableOverdueCents)}
              negative={data.balances.payableOverdueCents > 0}
              hint={`${data.balances.payableOverdueCount} conta(s) · em aberto ${brl(data.balances.payableOpenCents)}`}
            />
          </div>
          {data.wonDealsWithoutContract.length > 0 && (
            <p className="rounded-lg border border-accent-500/40 bg-card p-4 text-sm">
              {data.wonDealsWithoutContract.length} negócio(s) ganho(s) sem contrato — a receita deles ainda não está prevista.{' '}
              <Link href={base} className="text-accent-500 hover:underline">
                Ver detalhes
              </Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
