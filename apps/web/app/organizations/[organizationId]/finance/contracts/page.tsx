'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { FINANCIAL_CATEGORY_LABELS, INCOME_CATEGORIES, type FinancialCategory } from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useCustomers } from '@/lib/customers/use-customers';
import { useContracts, useCreateContract, useUpdateContractStatus } from '@/lib/finance/use-finance';
import { FINANCE_WRITE_ROLES, type Contract, type ContractBilling } from '@/lib/finance/types';
import { brl, fmtDate, reaisToCents, todayKey } from '@/lib/finance/format';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, Field } from '@/components/finance/finance-ui';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);
const STATUS_LABEL = { ACTIVE: 'Ativo', COMPLETED: 'Concluído', CANCELLED: 'Cancelado' } as const;
const STATUS_CLASS = {
  ACTIVE: 'bg-positive-500/15 text-positive-500',
  COMPLETED: 'bg-info-500/15 text-info-500',
  CANCELLED: 'bg-ink-800 text-ink-300 line-through',
} as const;

function NewContractDialog({ organizationId, open, onClose }: { organizationId: string; open: boolean; onClose: () => void }) {
  const create = useCreateContract(organizationId);
  const customers = useCustomers(organizationId);
  const [customerId, setCustomerId] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FinancialCategory>('PROJECT');
  const [billing, setBilling] = useState<ContractBilling>('ONE_TIME');
  const [value, setValue] = useState('');
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState('');
  const [billingDay, setBillingDay] = useState('5');
  const [firstDue, setFirstDue] = useState('');
  const [generate, setGenerate] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const valueCents = reaisToCents(value);
    if (!customerId) return setError('Escolha o cliente.');
    if (valueCents === null) return setError('Informe um valor maior que zero.');
    const day = Number(billingDay);
    if (billing === 'MONTHLY' && !(Number.isInteger(day) && day >= 1 && day <= 31)) {
      return setError('O dia de cobrança deve ser de 1 a 31.');
    }
    create.mutate(
      {
        customerId,
        title: title.trim(),
        category,
        billing,
        valueCents,
        startDate,
        endDate: endDate || undefined,
        billingDay: billing === 'MONTHLY' ? day : undefined,
        generateBilling: billing === 'ONE_TIME' ? generate : undefined,
        firstDueDate: billing === 'ONE_TIME' && generate && firstDue ? firstDue : undefined,
      },
      {
        onSuccess: () => {
          setTitle('');
          setValue('');
          onClose();
        },
        onError: (e) => setError(errorText(e, 'Não foi possível criar o contrato.')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo contrato</DialogTitle>
          <DialogDescription>
            Mensal gera a recorrência automaticamente; pontual cria uma cobrança prevista.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Cliente">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">Selecione…</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Título">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoria">
              <Select value={category} onChange={(e) => setCategory(e.target.value as FinancialCategory)}>
                {INCOME_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {FINANCIAL_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cobrança">
              <Select value={billing} onChange={(e) => setBilling(e.target.value as ContractBilling)}>
                <option value="ONE_TIME">Pontual</option>
                <option value="MONTHLY">Mensal</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={billing === 'MONTHLY' ? 'Valor mensal (R$)' : 'Valor total (R$)'}>
              <Input inputMode="decimal" placeholder="0,00" value={value} onChange={(e) => setValue(e.target.value)} required />
            </Field>
            {billing === 'MONTHLY' && (
              <Field label="Dia da cobrança">
                <Input type="number" min={1} max={31} value={billingDay} onChange={(e) => setBillingDay(e.target.value)} />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Início">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </Field>
            <Field label="Fim (opcional)">
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          {billing === 'ONE_TIME' && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={generate} onChange={(e) => setGenerate(e.target.checked)} />
                Criar a cobrança prevista agora
              </label>
              {generate && (
                <Field label="Vencimento previsto (opcional)">
                  <Input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
                </Field>
              )}
            </>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Salvando…' : 'Criar contrato'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContractRow({ contract, organizationId, canWrite }: { contract: Contract; organizationId: string; canWrite: boolean }) {
  const update = useUpdateContractStatus(organizationId, contract.id);
  const [error, setError] = useState<string | null>(null);
  const change = (status: 'COMPLETED' | 'CANCELLED') => {
    const verb = status === 'COMPLETED' ? 'Concluir' : 'Cancelar';
    const extra = status === 'CANCELLED' ? ' As cobranças ainda previstas serão canceladas; o que já foi recebido é mantido.' : '';
    if (!window.confirm(`${verb} o contrato "${contract.title}"?${extra}`)) return;
    setError(null);
    update.mutate(status, { onError: (e) => setError(errorText(e, 'Não foi possível alterar o contrato.')) });
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{contract.title}</p>
          <p className="text-xs text-muted-foreground">
            {contract.customerName ?? 'Cliente'} · {FINANCIAL_CATEGORY_LABELS[contract.category]} ·{' '}
            {contract.billing === 'MONTHLY' ? `mensal, dia ${contract.billingDay}` : 'pontual'} · desde {fmtDate(contract.startDate)}
            {contract.endDate ? ` até ${fmtDate(contract.endDate)}` : ''}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[contract.status]}`}>
          {STATUS_LABEL[contract.status]}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{contract.billing === 'MONTHLY' ? 'Valor mensal' : 'Valor'}</dt>
          <dd className="tabular-nums">{brl(contract.valueCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Faturado</dt>
          <dd className="tabular-nums">{brl(contract.invoicedCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Recebido</dt>
          <dd className="tabular-nums text-positive-500">{brl(contract.receivedCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Em aberto</dt>
          <dd className="tabular-nums">{brl(contract.outstandingCents)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {canWrite && contract.status === 'ACTIVE' && (
          <>
            <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => change('COMPLETED')}>
              Concluir
            </Button>
            <Button size="sm" variant="ghost" className="text-negative-500" disabled={update.isPending} onClick={() => change('CANCELLED')}>
              Cancelar
            </Button>
          </>
        )}
      </div>
      <FormError message={error} />
    </Card>
  );
}

export default function ContractsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? FINANCE_WRITE_ROLES.includes(membership.role) : false;
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const contracts = useContracts(organizationId, status || undefined);
  const rows = contracts.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação do contrato">
          <option value="">Todos os contratos</option>
          <option value="ACTIVE">Ativos</option>
          <option value="COMPLETED">Concluídos</option>
          <option value="CANCELLED">Cancelados</option>
        </Select>
        {canWrite && (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            Novo contrato
          </Button>
        )}
      </div>
      {contracts.isError && <FormError message={errorText(contracts.error, 'Não foi possível carregar os contratos.')} />}
      {contracts.isLoading && <Skeleton className="h-40" />}
      {contracts.data && rows.length === 0 && (
        <EmptyState
          title="Nenhum contrato"
          description="Contratos ligam um cliente a uma receita prevista. Crie um aqui, ou abra um negócio ganho e gere o contrato a partir dele."
          action={{ label: 'Ver negócios', href: `/organizations/${organizationId}/deals` }}
        />
      )}
      <div className="grid gap-3">
        {rows.map((c) => (
          <ContractRow key={c.id} contract={c} organizationId={organizationId} canWrite={canWrite} />
        ))}
      </div>
      <NewContractDialog organizationId={organizationId} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
