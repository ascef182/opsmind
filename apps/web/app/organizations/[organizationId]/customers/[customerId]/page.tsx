'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  useAddNote,
  useCustomer,
  useCustomerTimeline,
  useUpdateCustomer,
} from '@/lib/customers/use-customers';
import type { CustomerStatus } from '@/lib/customers/types';
import { useCustomerDeals } from '@/lib/deals/use-deals';
import { formatCurrency } from '@/lib/deals/types';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

const STATUS_OPTIONS: CustomerStatus[] = ['LEAD', 'ACTIVE', 'INACTIVE'];

export default function CustomerDetailPage() {
  const { organizationId, customerId } = useParams<{ organizationId: string; customerId: string }>();
  const customer = useCustomer(organizationId, customerId);
  const timeline = useCustomerTimeline(organizationId, customerId);
  const deals = useCustomerDeals(organizationId, customerId);
  const updateCustomer = useUpdateCustomer(organizationId, customerId);
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
        </div>
      </Card>

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
