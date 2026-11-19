'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useCompanyOverview } from '@/lib/opsgov/use-company';
import { useClassifyRevenue, useRbt12, useRevenueByActivity, useUnclassifiedRevenue } from '@/lib/opsgov/use-revenue';
import {
  OPSGOV_FINANCE_ROLES,
  RBT12_METHOD_LABELS,
  REVENUE_BASIS_LABELS,
  REVENUE_GROUP_LABELS,
  type RevenueBasis,
  type RevenueLine,
} from '@/lib/opsgov/types';
import { brl, currentMonthKey, fmtDate, fmtMonth, shiftMonth } from '@/lib/finance/format';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, Field, Kpi } from '@/components/finance/finance-ui';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

function Rbt12Card({ organizationId, basis }: { organizationId: string; basis: RevenueBasis }) {
  const month = currentMonthKey();
  const rbt12 = useRbt12(organizationId, month, basis);
  if (rbt12.isLoading) return <Skeleton className="h-24 w-full" />;
  if (!rbt12.data) return null;
  const { rbt12Cents, method, monthsConsidered } = rbt12.data;
  const window =
    monthsConsidered.length > 0
      ? `${fmtMonth(monthsConsidered[0]!)} a ${fmtMonth(monthsConsidered[monthsConsidered.length - 1]!)}`
      : '';
  return (
    <Kpi
      label={`RBT12 para apuração de ${fmtMonth(month)}`}
      value={brl(rbt12Cents)}
      hint={`${RBT12_METHOD_LABELS[method]} · ${window} · ${REVENUE_BASIS_LABELS[basis]}`}
    />
  );
}

function ClassifySection({ organizationId }: { organizationId: string }) {
  const unclassified = useUnclassifiedRevenue(organizationId);
  const company = useCompanyOverview(organizationId);
  const classify = useClassifyRevenue(organizationId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activityId, setActivityId] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Uma opção por CNAE (a versão vigente); a API resolve a versão certa pela data de cada lançamento.
  const cnaes = useMemo(() => {
    const byCnae = new Map<string, { id: string; label: string }>();
    for (const a of company.data?.activities ?? []) {
      const current = byCnae.get(a.cnae);
      if (!current || a.validTo === null) byCnae.set(a.cnae, { id: a.id, label: `${a.cnae} · ${a.description}` });
    }
    return [...byCnae.values()];
  }, [company.data]);

  const rows = unclassified.data ?? [];
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    if (!activityId) return setError('Escolha o CNAE.');
    classify.mutate(
      { entryIds: [...selected], companyActivityId: activityId },
      {
        onSuccess: () => setSelected(new Set()),
        onError: (e) => setError(errorText(e, 'Não foi possível classificar.')),
      },
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3">Receitas sem atividade</h2>
        <p className="text-sm text-muted-foreground">
          Receitas da empresa ainda sem CNAE. Lançamentos pessoais nunca aparecem aqui nem entram no faturamento.
        </p>
      </div>
      {unclassified.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todas as receitas estão classificadas.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Classificar selecionados como">
              <Select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="min-w-72">
                <option value="">Escolha o CNAE…</option>
                {cnaes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button onClick={submit} disabled={selected.size === 0} isLoading={classify.isPending}>
              Classificar {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
            <FormError message={error} />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todas"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    />
                  </TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} onClick={() => toggle(r.id)} className="cursor-pointer">
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${r.description}`}
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.issueDate)}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell className="text-muted-foreground">{r.customerName ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(r.amountCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Card>
  );
}

function LineCells({ line }: { line: RevenueLine }) {
  return (
    <>
      {line.monthsCents.map((cents, i) => (
        <TableCell key={i} className="text-right tabular-nums text-muted-foreground">
          {cents ? brl(cents) : '—'}
        </TableCell>
      ))}
      <TableCell className="text-right font-medium tabular-nums">{brl(line.totalCents)}</TableCell>
    </>
  );
}

function ReportSection({ organizationId, basis }: { organizationId: string; basis: RevenueBasis }) {
  const [to, setTo] = useState(currentMonthKey());
  const [from, setFrom] = useState(shiftMonth(currentMonthKey(), -11));
  const report = useRevenueByActivity(organizationId, { from, to, basis });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-h3">Receita por atividade × mês</h2>
        <div className="flex gap-3">
          <Field label="De">
            <Input type="month" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </Field>
          <Field label="Até">
            <Input type="month" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </Field>
        </div>
      </div>
      {report.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : report.isError || !report.data ? (
        <FormError message={errorText(report.error, 'Não foi possível carregar o relatório.')} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Atividade</TableHead>
                {report.data.months.map((m) => (
                  <TableHead key={m} className="whitespace-nowrap text-right">
                    {fmtMonth(m)}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Cada CNAE aparece sob o grupo da sua versão atual; o total do grupo segue a versão vigente na emissão. */}
              {report.data.groups.flatMap((g) => [
                <TableRow key={g.revenueGroup} className="bg-muted/30">
                  <TableCell className="font-medium">{REVENUE_GROUP_LABELS[g.revenueGroup]}</TableCell>
                  <LineCells line={g} />
                </TableRow>,
                ...report.data.rows
                  .filter((r) => r.revenueGroup === g.revenueGroup)
                  .map((r) => (
                    <TableRow key={r.cnae}>
                      <TableCell className="whitespace-nowrap pl-6 text-sm">
                        <span className="font-mono">{r.cnae}</span> · {r.description}
                      </TableCell>
                      <LineCells line={r} />
                    </TableRow>
                  )),
              ])}
              <TableRow className="bg-muted/30">
                <TableCell className="font-medium text-muted-foreground">Sem atividade</TableCell>
                <LineCells line={report.data.unclassified} />
              </TableRow>
              <TableRow className="border-t-2 border-border">
                <TableCell className="font-semibold">Total da empresa</TableCell>
                <LineCells line={report.data.totals} />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export default function ReceitaPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership, isLoading } = useCurrentMembership(organizationId);
  const [basis, setBasis] = useState<RevenueBasis>('COMPETENCIA');

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!membership || !OPSGOV_FINANCE_ROLES.includes(membership.role)) {
    return (
      <EmptyState
        title="Sem acesso à receita"
        description="O faturamento por atividade fica disponível para gerentes, administradores e donos da organização."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Só receitas da empresa entram aqui. A classificação usa a versão do CNAE vigente na data de emissão de cada lançamento.
        </p>
        <Field label="Base">
          <Select value={basis} onChange={(e) => setBasis(e.target.value as RevenueBasis)}>
            {(Object.keys(REVENUE_BASIS_LABELS) as RevenueBasis[]).map((b) => (
              <option key={b} value={b}>
                {REVENUE_BASIS_LABELS[b]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Rbt12Card organizationId={organizationId} basis={basis} />
      <ClassifySection organizationId={organizationId} />
      <ReportSection organizationId={organizationId} basis={basis} />
    </div>
  );
}
