'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  estimateBrlFromForeign,
  EXPENSE_CATEGORIES,
  FINANCIAL_CATEGORY_LABELS,
  FINANCIAL_SCOPE_LABELS,
  INCOME_CATEGORIES,
  type DisplayStatus,
  type FinancialCategory,
  type FinancialDirection,
  type FinancialScope,
} from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useContracts } from '@/lib/finance/use-finance';
import { useCustomers } from '@/lib/customers/use-customers';
import {
  downloadEntriesCsv,
  useCancelEntry,
  useCreateEntry,
  useFinancialEntries,
  useFinancialEntry,
  useIssueEntry,
  useRegisterPayment,
  useReversePayment,
  useUpdateEntry,
} from '@/lib/finance/use-finance';
import { FINANCE_WRITE_ROLES, type EntryFilter, type FinancialEntry } from '@/lib/finance/types';
import { brl, centsToReaisInput, fmtDate, fmtForeign, reaisToCents, STATUS_LABEL, todayKey } from '@/lib/finance/format';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, Field, StatusPill } from '@/components/finance/finance-ui';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

function NewEntryDialog({
  organizationId,
  open,
  onClose,
}: {
  organizationId: string;
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateEntry(organizationId);
  const customers = useCustomers(organizationId);
  const contracts = useContracts(organizationId);
  const [direction, setDirection] = useState<FinancialDirection>('INCOME');
  const [category, setCategory] = useState<FinancialCategory>('PROJECT');
  const [scope, setScope] = useState<FinancialScope>('BUSINESS');
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [contractId, setContractId] = useState('');
  const [amount, setAmount] = useState('');
  const [fees, setFees] = useState('');
  const [dueDate, setDueDate] = useState(todayKey());
  const [planned, setPlanned] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const categories = direction === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const customerContracts = (contracts.data ?? []).filter((c) => !customerId || c.customerId === customerId);

  function changeDirection(next: FinancialDirection) {
    setDirection(next);
    setCategory((next === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0]);
    if (next === 'EXPENSE') {
      setContractId('');
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const amountCents = reaisToCents(amount);
    if (amountCents === null) return setError('Informe um valor maior que zero (ex.: 1.500,00).');
    const feesCents = fees.trim() ? reaisToCents(fees) : 0;
    if (feesCents === null) return setError('Taxa inválida.');
    if (!description.trim()) return setError('Descreva o lançamento.');
    if (!dueDate) return setError('Informe o vencimento.');
    create.mutate(
      {
        direction,
        category,
        scope,
        description: description.trim(),
        supplierName: direction === 'EXPENSE' && supplier.trim() ? supplier.trim() : undefined,
        customerId: customerId || undefined,
        contractId: contractId || undefined,
        amountCents,
        feesCents: feesCents || undefined,
        dueDate,
        status: planned ? 'PLANNED' : 'PENDING',
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          setDescription('');
          setAmount('');
          setFees('');
          setNotes('');
          setSupplier('');
          onClose();
        },
        onError: (e) => setError(errorText(e, 'Não foi possível salvar o lançamento.')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo lançamento</DialogTitle>
          <DialogDescription>Receita a receber ou despesa a pagar. O pagamento é registrado depois.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select value={direction} onChange={(e) => changeDirection(e.target.value as FinancialDirection)}>
                <option value="INCOME">Receita</option>
                <option value="EXPENSE">Despesa</option>
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cliente (opcional)">
              <Select
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setContractId('');
                }}
              >
                <option value="">—</option>
                {(customers.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {direction === 'INCOME' && (
              <Field label="Contrato (opcional)">
                <Select value={contractId} onChange={(e) => setContractId(e.target.value)}>
                  <option value="">—</option>
                  {customerContracts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Valor (R$)">
              <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label="Taxas (R$)">
              <Input inputMode="decimal" placeholder="0,00" value={fees} onChange={(e) => setFees(e.target.value)} />
            </Field>
            <Field label="Vencimento">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            </Field>
          </div>
          {direction === 'INCOME' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)} />
              Apenas previsto (ainda não faturado)
            </label>
          )}
          <Field label="Observações (opcional)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </Field>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EntryDetailDialog({
  organizationId,
  entryId,
  canWrite,
  onClose,
}: {
  organizationId: string;
  entryId: string | null;
  canWrite: boolean;
  onClose: () => void;
}) {
  const entry = useFinancialEntry(organizationId, entryId);
  const pay = useRegisterPayment(organizationId, entryId ?? '');
  const reverse = useReversePayment(organizationId, entryId ?? '');
  const cancel = useCancelEntry(organizationId, entryId ?? '');
  const issue = useIssueEntry(organizationId, entryId ?? '');
  const updateFx = useUpdateEntry(organizationId, entryId ?? '');
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(todayKey());
  const [method, setMethod] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'cancel'>('view');
  const [reason, setReason] = useState('');
  const [issueDue, setIssueDue] = useState('');
  const [fxForeignAmount, setFxForeignAmount] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [fxIof, setFxIof] = useState('');
  const [fxError, setFxError] = useState<string | null>(null);

  const e: FinancialEntry | undefined = entry.data;

  // Sincroniza os campos de câmbio com o lançamento carregado — roda de novo
  // só quando a entrada trocada é outra (o dialog é uma instância única,
  // reusada entre aberturas, não remontada por lançamento). Depender só do id
  // (não de `e`) é intencional: um refetch da MESMA entrada (ex.: foco na
  // janela) não deve sobrescrever o que o usuário está digitando no formulário.
  useEffect(() => {
    if (!e) return;
    setFxForeignAmount(e.foreignAmountCents ? centsToReaisInput(e.foreignAmountCents) : '');
    setFxRate(e.exchangeRate ? String(e.exchangeRate) : '');
    setFxIof(e.iofCents ? centsToReaisInput(e.iofCents) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e?.id]);

  const fail = (err: unknown) => setError(errorText(err, 'A operação falhou.'));
  const close = () => {
    setError(null);
    setMode('view');
    setReason('');
    setAmount('');
    onClose();
  };

  function submitPayment(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    const cents = reaisToCents(amount);
    if (cents === null) return setError('Informe um valor maior que zero.');
    pay.mutate(
      { amountCents: cents, paidAt, method: method.trim() || undefined },
      { onSuccess: () => setAmount(''), onError: fail },
    );
  }

  const fxForeignCents = reaisToCents(fxForeignAmount);
  const fxRateNumber = Number(fxRate.replace(',', '.'));
  const fxIofCents = fxIof.trim() ? reaisToCents(fxIof) : 0;
  const fxSuggested =
    fxForeignCents && fxRateNumber > 0 ? estimateBrlFromForeign(fxForeignCents, fxRateNumber, fxIofCents ?? 0) : null;

  function submitFx(ev: React.FormEvent) {
    ev.preventDefault();
    setFxError(null);
    if (fxForeignCents === null) return setFxError('Informe o valor em dólar do extrato.');
    if (!(fxRateNumber > 0)) return setFxError('Informe a cotação do dia.');
    if (fxIofCents === null) return setFxError('IOF inválido.');
    if (fxSuggested === null) return setFxError('Não foi possível calcular o valor sugerido.');
    updateFx.mutate(
      {
        amountCents: fxSuggested,
        foreignCurrency: 'USD',
        foreignAmountCents: fxForeignCents,
        exchangeRate: fxRateNumber,
        iofCents: fxIofCents,
      },
      { onError: (err) => setFxError(errorText(err, 'Não foi possível salvar o câmbio.')) },
    );
  }

  const canPay = canWrite && e && (e.status === 'PENDING' || e.status === 'PARTIAL');
  const isIncome = e?.direction === 'INCOME';

  return (
    <Dialog open={Boolean(entryId)} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{e?.description ?? 'Lançamento'}</DialogTitle>
          <DialogDescription>
            {e
              ? `${isIncome ? 'Receita' : 'Despesa'} · ${FINANCIAL_CATEGORY_LABELS[e.category]} · ${FINANCIAL_SCOPE_LABELS[e.scope]}`
              : 'Carregando…'}
          </DialogDescription>
        </DialogHeader>
        {entry.isLoading && <Skeleton className="h-32" />}
        {entry.isError && <FormError message={errorText(entry.error, 'Não foi possível carregar o lançamento.')} />}
        {e && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex items-center justify-between">
              <StatusPill status={e.displayStatus} />
              <span className="text-xs text-muted-foreground">
                Emissão {fmtDate(e.issueDate)} · Vencimento {fmtDate(e.dueDate)}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Valor</dt>
              <dd className="text-right tabular-nums">{brl(e.amountCents)}</dd>
              <dt className="text-muted-foreground">Taxas</dt>
              <dd className="text-right tabular-nums">{brl(e.feesCents)}</dd>
              <dt className="text-muted-foreground">Pago</dt>
              <dd className="text-right tabular-nums">{brl(e.paidCents)}</dd>
              <dt className="text-muted-foreground">Em aberto</dt>
              <dd className="text-right tabular-nums">{brl(e.outstandingCents)}</dd>
              {e.customerName && (
                <>
                  <dt className="text-muted-foreground">Cliente</dt>
                  <dd className="text-right">{e.customerName}</dd>
                </>
              )}
              {e.contractTitle && (
                <>
                  <dt className="text-muted-foreground">Contrato</dt>
                  <dd className="text-right">{e.contractTitle}</dd>
                </>
              )}
              {e.supplierName && (
                <>
                  <dt className="text-muted-foreground">Fornecedor</dt>
                  <dd className="text-right">{e.supplierName}</dd>
                </>
              )}
              {e.foreignCurrency && e.foreignAmountCents && (
                <>
                  <dt className="text-muted-foreground">Câmbio</dt>
                  <dd className="text-right">
                    {fmtForeign(e.foreignAmountCents, e.foreignCurrency)}
                    {e.exchangeRate ? ` × ${e.exchangeRate.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}
                    {e.iofCents ? ` + ${brl(e.iofCents)} IOF` : ''}
                  </dd>
                </>
              )}
            </dl>
            {e.notes && <p className="text-muted-foreground">{e.notes}</p>}
            {e.cancelReason && <p className="text-negative-500">Cancelado: {e.cancelReason}</p>}

            <section className="flex flex-col gap-2">
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Pagamentos</h3>
              {(e.payments ?? []).length === 0 ? (
                <p className="text-muted-foreground">Nenhum pagamento registrado.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {(e.payments ?? []).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                      <div className={p.reversedAt ? 'text-muted-foreground line-through' : undefined}>
                        <span className="tabular-nums">{brl(p.amountCents)}</span> · {fmtDate(p.paidAt)}
                        {p.method ? ` · ${p.method}` : ''}
                        {p.reversedAt && p.reverseReason ? ` (estornado: ${p.reverseReason})` : ''}
                      </div>
                      {canWrite && !p.reversedAt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={reverse.isPending}
                          onClick={() => {
                            const why = window.prompt('Motivo do estorno:');
                            if (!why?.trim()) return;
                            setError(null);
                            reverse.mutate({ paymentId: p.id, reason: why.trim() }, { onError: fail });
                          }}
                        >
                          Estornar
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canPay && (
              <form onSubmit={submitFx} className="flex flex-col gap-3 rounded-md border border-border p-3">
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Câmbio</h3>
                <p className="text-xs text-muted-foreground">
                  Para despesas/receitas cotadas em dólar: confira o valor real no e-mail/extrato e preencha a
                  cotação e o IOF do dia — o valor do lançamento é ajustado para o total real cobrado.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Valor (US$)">
                    <Input inputMode="decimal" value={fxForeignAmount} onChange={(ev) => setFxForeignAmount(ev.target.value)} placeholder="0,00" />
                  </Field>
                  <Field label="Cotação do dia">
                    <Input inputMode="decimal" value={fxRate} onChange={(ev) => setFxRate(ev.target.value)} placeholder="5,62" />
                  </Field>
                  <Field label="IOF (R$)">
                    <Input inputMode="decimal" value={fxIof} onChange={(ev) => setFxIof(ev.target.value)} placeholder="0,00" />
                  </Field>
                </div>
                {fxSuggested !== null && (
                  <p className="text-sm text-muted-foreground">
                    Valor do lançamento passa a ser <span className="tabular-nums text-foreground">{brl(fxSuggested)}</span>.
                  </p>
                )}
                <FormError message={fxError} />
                <Button type="submit" size="sm" variant="secondary" disabled={updateFx.isPending}>
                  {updateFx.isPending ? 'Salvando…' : 'Salvar câmbio'}
                </Button>
              </form>
            )}

            {canPay && (
              <form onSubmit={submitPayment} className="flex flex-col gap-3 rounded-md border border-border p-3">
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
                  Registrar {isIncome ? 'recebimento' : 'pagamento'}
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Valor (R$)">
                    <Input inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="0,00" />
                  </Field>
                  <Field label="Data">
                    <Input type="date" value={paidAt} max={todayKey()} onChange={(ev) => setPaidAt(ev.target.value)} />
                  </Field>
                  <Field label="Forma">
                    <Input value={method} onChange={(ev) => setMethod(ev.target.value)} placeholder="Pix, boleto…" maxLength={60} />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={pay.isPending}>
                    {pay.isPending ? 'Salvando…' : 'Registrar'}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setAmount(centsToReaisInput(e.outstandingCents))}>
                    Quitar saldo ({brl(e.outstandingCents)})
                  </Button>
                </div>
              </form>
            )}

            {canWrite && e.status === 'PLANNED' && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
                <Field label="Novo vencimento (opcional)">
                  <Input type="date" value={issueDue} onChange={(ev) => setIssueDue(ev.target.value)} />
                </Field>
                <Button
                  size="sm"
                  disabled={issue.isPending}
                  onClick={() => {
                    setError(null);
                    issue.mutate(issueDue || undefined, { onError: fail });
                  }}
                >
                  Faturar (emitir cobrança)
                </Button>
              </div>
            )}

            {canWrite && e.status !== 'CANCELLED' && e.paidCents === 0 && (
              mode === 'view' ? (
                <Button size="sm" variant="ghost" className="self-start text-negative-500" onClick={() => setMode('cancel')}>
                  Cancelar lançamento
                </Button>
              ) : (
                <div className="flex flex-col gap-2 rounded-md border border-negative-500/40 p-3">
                  <Field label="Motivo do cancelamento">
                    <Input value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={300} />
                  </Field>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={!reason.trim() || cancel.isPending}
                      onClick={() => {
                        setError(null);
                        cancel.mutate(reason.trim(), {
                          onSuccess: () => setMode('view'),
                          onError: fail,
                        });
                      }}
                    >
                      Confirmar cancelamento
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
                      Voltar
                    </Button>
                  </div>
                </div>
              )
            )}
            <FormError message={error} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const STATUS_OPTIONS: DisplayStatus[] = ['PLANNED', 'PENDING', 'PARTIAL', 'OVERDUE', 'PAID', 'CANCELLED'];

export default function EntriesPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const params = useSearchParams();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? FINANCE_WRITE_ROLES.includes(membership.role) : false;

  const [direction, setDirection] = useState<FinancialDirection | ''>((params.get('direction') as FinancialDirection) || '');
  const [status, setStatus] = useState<DisplayStatus | ''>((params.get('status') as DisplayStatus) || '');
  const [category, setCategory] = useState<FinancialCategory | ''>('');
  const [scope, setScope] = useState<FinancialScope | ''>('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<'asc' | 'desc'>('desc');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const filter: EntryFilter = useMemo(
    () => ({
      direction: direction || undefined,
      status: status || undefined,
      category: category || undefined,
      scope: scope || undefined,
      search: search.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
      sort,
    }),
    [direction, status, category, scope, search, from, to, sort],
  );
  const entries = useFinancialEntries(organizationId, filter);
  const allCategories = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
  const rows = entries.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Select className="w-36" value={direction} onChange={(e) => setDirection(e.target.value as FinancialDirection | '')} aria-label="Tipo">
          <option value="">Receitas e despesas</option>
          <option value="INCOME">Receitas</option>
          <option value="EXPENSE">Despesas</option>
        </Select>
        <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value as DisplayStatus | '')} aria-label="Situação">
          <option value="">Todas as situações</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select className="w-44" value={category} onChange={(e) => setCategory(e.target.value as FinancialCategory | '')} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>
              {FINANCIAL_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Select className="w-40" value={scope} onChange={(e) => setScope(e.target.value as FinancialScope | '')} aria-label="Escopo">
          <option value="">Pessoal e empresa</option>
          <option value="BUSINESS">{FINANCIAL_SCOPE_LABELS.BUSINESS}</option>
          <option value="PERSONAL">{FINANCIAL_SCOPE_LABELS.PERSONAL}</option>
        </Select>
        <Input className="w-40" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Vencimento de" />
        <Input className="w-40" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Vencimento até" />
        <Input className="w-48" placeholder="Buscar descrição…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="w-44" value={sort} onChange={(e) => setSort(e.target.value as 'asc' | 'desc')} aria-label="Ordenar por">
          <option value="desc">Mais recentes primeiro</option>
          <option value="asc">Mais antigos primeiro</option>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setExportError(null);
              downloadEntriesCsv(organizationId, filter).catch((e) => setExportError(errorText(e, 'Falha ao exportar.')));
            }}
          >
            Exportar CSV
          </Button>
          {canWrite && <Button onClick={() => setCreating(true)}>Novo lançamento</Button>}
        </div>
      </div>
      <FormError message={exportError} />
      {entries.isError && <FormError message={errorText(entries.error, 'Não foi possível carregar os lançamentos.')} />}
      {entries.isLoading && <Skeleton className="h-48" />}
      {entries.data && rows.length === 0 && (
        <EmptyState
          title="Nenhum lançamento encontrado"
          description={
            direction || status || category || scope || search || from || to
              ? 'Nenhum lançamento bate com os filtros. Ajuste ou limpe os filtros.'
              : 'Ainda não há lançamentos. Crie um contrato para gerar a receita prevista, ou lance uma receita/despesa manualmente.'
          }
        />
      )}
      {rows.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Vencimento</th>
                <th className="px-4 py-2 font-medium">Descrição</th>
                <th className="px-4 py-2 font-medium">Categoria</th>
                <th className="px-4 py-2 font-medium">Escopo</th>
                <th className="px-4 py-2 text-right font-medium">Valor</th>
                <th className="px-4 py-2 text-right font-medium">Em aberto</th>
                <th className="px-4 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-ink-800/50"
                  onClick={() => setOpenId(row.id)}
                >
                  <td className="whitespace-nowrap px-4 py-2">{fmtDate(row.dueDate)}</td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      className="text-left hover:text-accent-400"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setOpenId(row.id);
                      }}
                    >
                      {row.description}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {row.customerName ?? row.supplierName ?? ''}
                      {row.foreignCurrency && row.foreignAmountCents ? ` · ${fmtForeign(row.foreignAmountCents, row.foreignCurrency)}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{FINANCIAL_CATEGORY_LABELS[row.category]}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {row.scope === 'PERSONAL' ? (
                      <span className="text-accent-400">{FINANCIAL_SCOPE_LABELS.PERSONAL}</span>
                    ) : (
                      FINANCIAL_SCOPE_LABELS.BUSINESS
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-2 text-right tabular-nums ${row.direction === 'EXPENSE' ? 'text-negative-500' : ''}`}
                  >
                    {row.direction === 'EXPENSE' ? '− ' : ''}
                    {brl(row.amountCents)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{brl(row.outstandingCents)}</td>
                  <td className="px-4 py-2">
                    <StatusPill status={row.displayStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <NewEntryDialog organizationId={organizationId} open={creating} onClose={() => setCreating(false)} />
      <EntryDetailDialog organizationId={organizationId} entryId={openId} canWrite={canWrite} onClose={() => setOpenId(null)} />
    </div>
  );
}
