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
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

const STATUS_OPTIONS: CustomerStatus[] = ['LEAD', 'ACTIVE', 'INACTIVE'];

export default function CustomerDetailPage() {
  const { organizationId, customerId } = useParams<{ organizationId: string; customerId: string }>();
  const customer = useCustomer(organizationId, customerId);
  const timeline = useCustomerTimeline(organizationId, customerId);
  const updateCustomer = useUpdateCustomer(organizationId, customerId);
  const addNote = useAddNote(organizationId, customerId);
  const [note, setNote] = useState('');

  if (customer.isLoading) {
    return <p className="text-slate-500">Carregando cliente…</p>;
  }
  if (customer.isError || !customer.data) {
    return <p className="text-red-700">Cliente não encontrado.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/organizations/${organizationId}/customers`}
        className="text-sm text-brand-600 hover:underline"
      >
        ← Voltar para clientes
      </Link>

      <Card className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{customer.data.name}</h1>
          <p className="text-slate-500">{customer.data.company ?? '—'}</p>
          <p className="text-sm text-slate-500">{customer.data.email ?? 'sem e-mail'}</p>
          {customer.data.tags.length > 0 && (
            <div className="mt-2 flex gap-1">
              {customer.data.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
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
        <h2 className="font-medium text-slate-900">Timeline</h2>
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
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
          <Button type="submit" isLoading={addNote.isPending}>
            Anotar
          </Button>
        </form>

        {timeline.isLoading && <p className="mt-3 text-sm text-slate-500">Carregando timeline…</p>}
        {timeline.isSuccess && timeline.data.length === 0 && (
          <p className="mt-3 text-sm text-slate-500">Nenhuma atividade registrada ainda.</p>
        )}
        <ul className="mt-3 flex flex-col gap-3">
          {timeline.data?.map((entry) => (
            <li key={entry.id} className="border-l-2 border-slate-200 pl-3 text-sm">
              <p className="text-slate-700">
                {entry.type}
                {typeof entry.payload?.note === 'string' && `: ${entry.payload.note}`}
                {typeof entry.payload?.title === 'string' && `: ${entry.payload.title}`}
              </p>
              <p className="text-xs text-slate-400">
                {new Date(entry.createdAt).toLocaleString('pt-BR')} · {entry.actorType}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
