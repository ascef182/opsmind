'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useAddNote,
  useCustomer,
  useCustomerTimeline,
  useDeleteCustomer,
  useUpdateCustomer,
} from '@/lib/customers/use-customers';
import { WRITE_ROLES, type CustomerStatus } from '@/lib/customers/types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useCustomerDeals } from '@/lib/deals/use-deals';
import { formatCurrency } from '@/lib/deals/types';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, FormError } from '@/components/ui/card';

const STATUS_OPTIONS: CustomerStatus[] = ['LEAD', 'ACTIVE', 'INACTIVE'];

export default function CustomerDetailPage() {
  const { organizationId, customerId } = useParams<{ organizationId: string; customerId: string }>();
  const router = useRouter();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;
  const customer = useCustomer(organizationId, customerId);
  const timeline = useCustomerTimeline(organizationId, customerId);
  const deals = useCustomerDeals(organizationId, customerId);
  const updateCustomer = useUpdateCustomer(organizationId, customerId);
  const deleteCustomer = useDeleteCustomer(organizationId);
  const addNote = useAddNote(organizationId, customerId);
  const [note, setNote] = useState('');

  if (customer.isLoading) {
    return <p className="text-muted-foreground">Carregando cliente…</p>;
  }
  if (customer.isError || !customer.data) {
    return <p className="text-destructive">Cliente não encontrado.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/organizations/${organizationId}/customers`}
        className="text-sm text-accent-500 hover:underline"
      >
        ← Voltar para clientes
      </Link>

      <Card className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{customer.data.name}</h1>
          <p className="text-muted-foreground">{customer.data.company ?? '—'}</p>
          <p className="text-sm text-muted-foreground">{customer.data.email ?? 'sem e-mail'}</p>
          <p className="text-sm text-muted-foreground">{customer.data.phone ?? 'sem telefone'}</p>
          {customer.data.tags.length > 0 && (
            <div className="mt-2 flex gap-1">
              {customer.data.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-ink-800 px-2 py-0.5 text-xs text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge value={customer.data.status} />
          {canWrite && (
            <Select
              value={customer.data.status}
              onChange={(e) => updateCustomer.mutate({ status: e.target.value as CustomerStatus })}
              className="w-40"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          )}
        </div>
      </Card>

      {canWrite && (
        <Card>
          <h2 className="font-medium text-foreground">Editar</h2>
          <form
            className="mt-3 grid grid-cols-2 gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const name = String(form.get('name') ?? '');
              const company = String(form.get('company') ?? '');
              const email = String(form.get('email') ?? '');
              const phone = String(form.get('phone') ?? '');
              const tags = String(form.get('tags') ?? '');
              updateCustomer.mutate({
                name: name || undefined,
                company: company || undefined,
                email: email || undefined,
                phone: phone || undefined,
                tags: tags
                  ? tags.split(',').map((t) => t.trim()).filter(Boolean)
                  : undefined,
              });
            }}
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome</label>
              <Input name="name" defaultValue={customer.data.name} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Empresa</label>
              <Input name="company" defaultValue={customer.data.company ?? ''} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">E-mail</label>
              <Input name="email" type="email" defaultValue={customer.data.email ?? ''} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Telefone</label>
              <Input name="phone" defaultValue={customer.data.phone ?? ''} />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Tags (separadas por vírgula)
              </label>
              <Input name="tags" defaultValue={customer.data.tags.join(', ')} />
            </div>
            <FormError
              message={updateCustomer.isError ? (updateCustomer.error as ApiError).message : null}
            />
            <div className="col-span-2 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                className="text-negative-500 hover:bg-negative-500/10"
                disabled={deleteCustomer.isPending}
                onClick={() => {
                  if (!window.confirm(`Excluir o cliente "${customer.data.name}"? Esta ação não pode ser desfeita.`)) {
                    return;
                  }
                  deleteCustomer.mutate(customerId, {
                    onSuccess: () => router.push(`/organizations/${organizationId}/customers`),
                  });
                }}
              >
                {deleteCustomer.isPending ? 'Excluindo…' : 'Excluir cliente'}
              </Button>
              <Button type="submit" disabled={updateCustomer.isPending}>
                {updateCustomer.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-foreground">Negócios</h2>
          <Link
            href={`/organizations/${organizationId}/deals?customerId=${customerId}`}
            className="text-sm text-accent-500 hover:underline"
          >
            + Novo negócio
          </Link>
        </div>
        {deals.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando negócios…</p>}
        {deals.isSuccess && deals.data.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum negócio para este cliente ainda.</p>
        )}
        <ul className="mt-3 flex flex-col gap-2">
          {deals.data?.map((deal) => (
            <li key={deal.id}>
              <Link
                href={`/organizations/${organizationId}/deals/${deal.id}`}
                className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-accent-500/40"
              >
                <span className="text-foreground">{deal.title}</span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">{formatCurrency(deal.value, deal.currency)}</span>
                  <Badge value={deal.stage} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="font-medium text-foreground">Timeline</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            addNote.mutate(note, { onSuccess: () => setNote('') });
          }}
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Adicionar uma nota…"
            className="flex-1 rounded-md border border-input bg-input/30 px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <Button type="submit" isLoading={addNote.isPending}>
            Anotar
          </Button>
        </form>

        {timeline.isLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando timeline…</p>}
        {timeline.isSuccess && timeline.data.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</p>
        )}
        <ul className="mt-3 flex flex-col gap-3">
          {timeline.data?.map((entry) => (
            <li key={entry.id} className="border-l-2 border-border pl-3 text-sm">
              <p className="text-foreground/80">
                {entry.type}
                {typeof entry.payload?.note === 'string' && `: ${entry.payload.note}`}
                {typeof entry.payload?.title === 'string' && `: ${entry.payload.title}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(entry.createdAt).toLocaleString('pt-BR')} · {entry.actorType}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
