'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useContracts, useCreateContractFromDeal } from '@/lib/finance/use-finance';
import { FINANCE_WRITE_ROLES } from '@/lib/finance/types';
import { brl } from '@/lib/finance/format';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/**
 * Fecha o elo negócio ganho → contrato → receita prevista → tarefas de
 * implantação. Só aparece para negócio WON e só para quem pode escrever no
 * financeiro (ADMIN+) — a API valida de novo (ver finance.controller.ts).
 */
export function DealContractCard({
  organizationId,
  dealId,
  dealStage,
}: {
  organizationId: string;
  dealId: string;
  dealStage: string;
}) {
  const { membership } = useCurrentMembership(organizationId);
  const canFinance = membership ? FINANCE_WRITE_ROLES.includes(membership.role) : false;
  const visible = dealStage === 'WON' && canFinance;
  const contracts = useContracts(organizationId, undefined, visible);
  const create = useCreateContractFromDeal(organizationId, dealId);
  const [billing, setBilling] = useState<'ONE_TIME' | 'MONTHLY'>('ONE_TIME');
  const [billingDay, setBillingDay] = useState('5');
  const [firstDue, setFirstDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!visible) return null;

  const existing = (contracts.data ?? []).find((c) => c.dealId === dealId && c.status !== 'CANCELLED');
  const base = `/organizations/${organizationId}/finance`;

  if (existing) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium text-foreground">Contrato gerado</h2>
          <p className="text-sm text-muted-foreground">
            {existing.title} · {brl(existing.valueCents)}
            {existing.billing === 'MONTHLY' ? ' por mês' : ''}
          </p>
        </div>
        <Link href={`${base}/contracts`} className="text-sm text-accent-500 hover:underline">
          Ver em Financeiro
        </Link>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="font-medium text-foreground">Gerar contrato e receita prevista</h2>
        <p className="text-sm text-muted-foreground">
          Cria o contrato deste negócio ganho, a cobrança prevista e 3 tarefas de implantação para o cliente.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Cobrança
          <Select className="w-36" value={billing} onChange={(e) => setBilling(e.target.value as 'ONE_TIME' | 'MONTHLY')}>
            <option value="ONE_TIME">Pontual</option>
            <option value="MONTHLY">Mensal</option>
          </Select>
        </label>
        {billing === 'MONTHLY' ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Dia da cobrança
            <Input className="w-28" type="number" min={1} max={31} value={billingDay} onChange={(e) => setBillingDay(e.target.value)} />
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Vencimento previsto (opcional)
            <Input className="w-44" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
          </label>
        )}
        <Button
          disabled={create.isPending}
          onClick={() => {
            setError(null);
            setDone(null);
            const day = Number(billingDay);
            if (billing === 'MONTHLY' && !(Number.isInteger(day) && day >= 1 && day <= 31)) {
              return setError('O dia de cobrança deve ser de 1 a 31.');
            }
            create.mutate(
              {
                billing,
                billingDay: billing === 'MONTHLY' ? day : undefined,
                firstDueDate: billing === 'ONE_TIME' && firstDue ? firstDue : undefined,
              },
              {
                onSuccess: (r) => setDone(`Contrato criado com ${r.tasksCreated} tarefa(s) de implantação.`),
                onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível gerar o contrato.'),
              },
            );
          }}
        >
          {create.isPending ? 'Gerando…' : 'Gerar contrato'}
        </Button>
      </div>
      {done && <p className="text-sm text-positive-500">{done}</p>}
      <FormError message={error} />
    </Card>
  );
}
