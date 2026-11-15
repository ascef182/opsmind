'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  EXPENSE_CATEGORIES,
  FINANCIAL_CATEGORY_LABELS,
  FINANCIAL_SCOPE_LABELS,
  INCOME_CATEGORIES,
  type FinancialCategory,
  type FinancialDirection,
  type FinancialScope,
} from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import {
  useCreateRecurring,
  useGenerateRecurring,
  useRecurringEntries,
  useToggleRecurring,
  useUpdateRecurring,
} from '@/lib/finance/use-finance';
import { FINANCE_WRITE_ROLES, type RecurringEntry } from '@/lib/finance/types';
import { brl, centsToReaisInput, currentMonthKey, fmtForeign, fmtMonth, reaisToCents } from '@/lib/finance/format';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, Field } from '@/components/finance/finance-ui';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

// Campo de moeda estrangeira compartilhado entre criar/editar recorrência —
// só guarda o valor nominal de referência (ex.: US$ 5,00/mês). Cotação e IOF
// reais de cada mês ficam no lançamento, não aqui (ver finance/entries).
function ForeignFields({
  isUsd,
  setIsUsd,
  foreignAmount,
  setForeignAmount,
}: {
  isUsd: boolean;
  setIsUsd: (v: boolean) => void;
  foreignAmount: string;
  setForeignAmount: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isUsd} onChange={(e) => setIsUsd(e.target.checked)} />
        Cobrada em dólar (valor em reais varia por câmbio/IOF)
      </label>
      {isUsd && (
        <Field label="Valor nominal (US$)" hint="Referência só — o valor em reais de cada mês é ajustado na hora de conciliar">
          <Input inputMode="decimal" placeholder="0,00" value={foreignAmount} onChange={(e) => setForeignAmount(e.target.value)} />
        </Field>
      )}
    </div>
  );
}

function NewRecurringDialog({ organizationId, open, onClose }: { organizationId: string; open: boolean; onClose: () => void }) {
  const create = useCreateRecurring(organizationId);
  const [direction, setDirection] = useState<FinancialDirection>('EXPENSE');
  const [category, setCategory] = useState<FinancialCategory>('INFRASTRUCTURE');
  const [scope, setScope] = useState<FinancialScope>('BUSINESS');
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('5');
  const [startMonth, setStartMonth] = useState(currentMonthKey());
  const [endMonth, setEndMonth] = useState('');
  const [isUsd, setIsUsd] = useState(false);
  const [foreignAmount, setForeignAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const categories = direction === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const amountCents = reaisToCents(amount);
    const dayOfMonth = Number(day);
    if (amountCents === null) return setError('Informe um valor maior que zero.');
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return setError('O dia deve ser de 1 a 31.');
    const foreignAmountCents = isUsd ? reaisToCents(foreignAmount) : undefined;
    if (isUsd && foreignAmountCents === null) return setError('Informe o valor nominal em dólar.');
    create.mutate(
      {
        direction,
        category,
        scope,
        description: description.trim(),
        supplierName: direction === 'EXPENSE' && supplier.trim() ? supplier.trim() : undefined,
        amountCents,
        foreignCurrency: isUsd ? 'USD' : undefined,
        foreignAmountCents: foreignAmountCents ?? undefined,
        dayOfMonth,
        startMonth: startMonth || undefined,
        endMonth: endMonth || undefined,
      },
      {
        onSuccess: () => {
          setDescription('');
          setAmount('');
          setSupplier('');
          setIsUsd(false);
          setForeignAmount('');
          onClose();
        },
        onError: (e) => setError(errorText(e, 'Não foi possível criar a recorrência.')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova recorrência</DialogTitle>
          <DialogDescription>
            Gera um lançamento por mês (ex.: VPS, domínio, assinatura de ferramenta). Os meses até hoje são criados na hora.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select
                value={direction}
                onChange={(e) => {
                  const next = e.target.value as FinancialDirection;
                  setDirection(next);
                  setCategory((next === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0]);
                }}
              >
                <option value="EXPENSE">Despesa</option>
                <option value="INCOME">Receita</option>
              </Select>
            </Field>
            <Field label="Categoria">
              <Select value={category} onChange={(e) => setCategory(e.target.value as FinancialCategory)}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {FINANCIAL_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Escopo">
              <Select value={scope} onChange={(e) => setScope(e.target.value as FinancialScope)}>
                <option value="BUSINESS">{FINANCIAL_SCOPE_LABELS.BUSINESS}</option>
                <option value="PERSONAL">{FINANCIAL_SCOPE_LABELS.PERSONAL}</option>
              </Select>
            </Field>
          </div>
          <Field label="Descrição">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} required />
          </Field>
          {direction === 'EXPENSE' && (
            <Field label="Fornecedor (opcional)">
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={200} />
            </Field>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Valor (R$)">
              <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label="Dia do mês" hint="31 vira o último dia dos meses curtos">
              <Input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="A partir de">
              <Input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
            </Field>
          </div>
          <Field label="Até (opcional)">
            <Input type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} />
          </Field>
          <ForeignFields isUsd={isUsd} setIsUsd={setIsUsd} foreignAmount={foreignAmount} setForeignAmount={setForeignAmount} />
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Salvando…' : 'Criar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Montado com `key={item.id}` no call site (RecurringPage) — cada item
// diferente ganha uma instância nova, então os `useState` abaixo partem do
// valor atual do item sem precisar de nenhum efeito de "resincronizar".
function EditRecurringDialog({
  organizationId,
  item,
  onClose,
}: {
  organizationId: string;
  item: RecurringEntry;
  onClose: () => void;
}) {
  const update = useUpdateRecurring(organizationId, item.id);
  const [amount, setAmount] = useState(centsToReaisInput(item.amountCents));
  const [supplier, setSupplier] = useState(item.supplierName ?? '');
  const [day, setDay] = useState(String(item.dayOfMonth));
  const [endMonth, setEndMonth] = useState(item.endMonth ?? '');
  const [isUsd, setIsUsd] = useState(Boolean(item.foreignCurrency && item.foreignAmountCents));
  const [foreignAmount, setForeignAmount] = useState(
    item.foreignAmountCents ? centsToReaisInput(item.foreignAmountCents) : '',
  );
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const amountCents = reaisToCents(amount);
    const dayOfMonth = Number(day);
    if (amountCents === null) return setError('Informe um valor maior que zero.');
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return setError('O dia deve ser de 1 a 31.');
    const foreignAmountCents = isUsd ? reaisToCents(foreignAmount) : null;
    if (isUsd && foreignAmountCents === null) return setError('Informe o valor nominal em dólar.');
    update.mutate(
      {
        amountCents,
        supplierName: supplier.trim() || null,
        dayOfMonth,
        endMonth: endMonth || null,
        foreignCurrency: isUsd ? 'USD' : null,
        foreignAmountCents: isUsd ? foreignAmountCents : null,
      },
      { onSuccess: onClose, onError: (e) => setError(errorText(e, 'Não foi possível salvar.')) },
    );
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar recorrência</DialogTitle>
          <DialogDescription>
            Vale só para os próximos meses a gerar — os já gerados não mudam.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Valor (R$)">
              <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label="Dia do mês" hint="31 vira o último dia dos meses curtos">
              <Input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="Até (opcional)">
              <Input type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} />
            </Field>
          </div>
          {item.direction === 'EXPENSE' && (
            <Field label="Fornecedor (opcional)">
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={200} />
            </Field>
          )}
          <ForeignFields isUsd={isUsd} setIsUsd={setIsUsd} foreignAmount={foreignAmount} setForeignAmount={setForeignAmount} />
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  item,
  organizationId,
  canWrite,
  onEdit,
}: {
  item: RecurringEntry;
  organizationId: string;
  canWrite: boolean;
  onEdit: () => void;
}) {
  const toggle = useToggleRecurring(organizationId, item.id);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{item.description}</p>
          <p className="text-xs text-muted-foreground">
            {item.direction === 'INCOME' ? 'Receita' : 'Despesa'} · {FINANCIAL_CATEGORY_LABELS[item.category]} ·{' '}
            {item.scope === 'PERSONAL' ? <span className="text-accent-400">{FINANCIAL_SCOPE_LABELS.PERSONAL}</span> : FINANCIAL_SCOPE_LABELS.BUSINESS}
            {item.supplierName ? ` · ${item.supplierName}` : ''} · todo dia {item.dayOfMonth} · {fmtMonth(item.startMonth)}
            {item.endMonth ? ` a ${fmtMonth(item.endMonth)}` : ' em diante'}
            {item.foreignCurrency && item.foreignAmountCents ? ` · ${fmtForeign(item.foreignAmountCents, item.foreignCurrency)}/mês` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`tabular-nums ${item.direction === 'EXPENSE' ? 'text-negative-500' : ''}`}>{brl(item.amountCents)}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.active ? 'bg-positive-500/15 text-positive-500' : 'bg-ink-800 text-ink-300'}`}
          >
            {item.active ? 'Ativa' : 'Pausada'}
          </span>
          {canWrite && (
            <>
              <Button size="sm" variant="secondary" onClick={onEdit}>
                Editar
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={toggle.isPending}
                onClick={() => {
                  setError(null);
                  toggle.mutate(!item.active, { onError: (e) => setError(errorText(e, 'Não foi possível alterar.')) });
                }}
              >
                {item.active ? 'Pausar' : 'Reativar'}
              </Button>
            </>
          )}
        </div>
      </div>
      {item.contractId && <p className="text-xs text-muted-foreground">Gerada por um contrato mensal.</p>}
      <FormError message={error} />
    </Card>
  );
}

export default function RecurringPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? FINANCE_WRITE_ROLES.includes(membership.role) : false;
  const items = useRecurringEntries(organizationId);
  const generate = useGenerateRecurring(organizationId);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const rows = items.data ?? [];
  const editingItem = rows.find((r) => r.id === editingId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {canWrite && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            disabled={generate.isPending || rows.length === 0}
            onClick={() => {
              setMessage(null);
              generate.mutate(undefined, {
                onSuccess: (r) =>
                  setMessage({
                    kind: 'ok',
                    text:
                      r.created > 0
                        ? `${r.created} lançamento(s) gerado(s) até ${fmtMonth(r.upToMonth)}.`
                        : 'Tudo em dia: não havia lançamentos pendentes de geração.',
                  }),
                onError: (e) => setMessage({ kind: 'error', text: errorText(e, 'Falha ao gerar lançamentos.') }),
              });
            }}
          >
            {generate.isPending ? 'Gerando…' : 'Gerar lançamentos do mês'}
          </Button>
          <Button onClick={() => setCreating(true)}>Nova recorrência</Button>
        </div>
      )}
      {message && (message.kind === 'ok' ? <p className="text-sm text-positive-500">{message.text}</p> : <FormError message={message.text} />)}
      {items.isError && <FormError message={errorText(items.error, 'Não foi possível carregar as recorrências.')} />}
      {items.isLoading && <Skeleton className="h-32" />}
      {items.data && rows.length === 0 && (
        <EmptyState
          title="Nenhuma recorrência"
          description="Cadastre custos fixos (VPS, domínios, ferramentas) ou receitas mensais. Contratos mensais criam a sua recorrência sozinhos."
        />
      )}
      <div className="grid gap-3">
        {rows.map((item) => (
          <Row
            key={item.id}
            item={item}
            organizationId={organizationId}
            canWrite={canWrite}
            onEdit={() => setEditingId(item.id)}
          />
        ))}
      </div>
      {editingItem && (
        <EditRecurringDialog
          key={editingItem.id}
          organizationId={organizationId}
          item={editingItem}
          onClose={() => setEditingId(null)}
        />
      )}
      <NewRecurringDialog organizationId={organizationId} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
