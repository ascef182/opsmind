'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateCustomer, useCustomers } from '@/lib/customers/use-customers';
import type { CustomerStatus } from '@/lib/customers/types';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, FormError } from '@/components/ui/card';

const createCustomerSchema = z.object({
  name: z.string().min(1, 'Informe um nome'),
  company: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
});

type CreateCustomerFormValues = z.infer<typeof createCustomerSchema>;

const STATUS_OPTIONS: Array<{ value: CustomerStatus | ''; label: string }> = [
  { value: '', label: 'Todos os status' },
  { value: 'LEAD', label: 'Lead' },
  { value: 'ACTIVE', label: 'Ativo' },
  { value: 'INACTIVE', label: 'Inativo' },
];

export default function CustomersPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const [status, setStatus] = useState<CustomerStatus | ''>('');
  const [search, setSearch] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const customers = useCustomers(organizationId, {
    status: status || undefined,
    search: search || undefined,
  });
  const createCustomer = useCreateCustomer(organizationId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateCustomerFormValues>({ resolver: zodResolver(createCustomerSchema) });

  const onSubmit = handleSubmit((values) => {
    createCustomer.mutate(
      { name: values.name, company: values.company || undefined, email: values.email || undefined },
      { onSuccess: () => { reset(); setShowCreateForm(false); } },
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por nome…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value as CustomerStatus | '')} className="max-w-[160px]">
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button variant="secondary" className="ml-auto" onClick={() => setShowCreateForm((v) => !v)}>
          + Novo cliente
        </Button>
      </div>

      {showCreateForm && (
        <Card>
          <h2 className="font-medium text-slate-900">Novo cliente</h2>
          <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex-1">
              <Input placeholder="Nome" {...register('name')} />
              <FormError message={errors.name?.message} />
            </div>
            <div className="flex-1">
              <Input placeholder="Empresa (opcional)" {...register('company')} />
            </div>
            <div className="flex-1">
              <Input placeholder="E-mail (opcional)" {...register('email')} />
              <FormError message={errors.email?.message} />
            </div>
            <Button type="submit" isLoading={createCustomer.isPending}>
              Criar
            </Button>
          </form>
          <FormError message={createCustomer.isError ? (createCustomer.error as ApiError).message : null} />
        </Card>
      )}

      {customers.isLoading && <p className="text-slate-500">Carregando clientes…</p>}
      {customers.isSuccess && customers.data.length === 0 && (
        <p className="text-slate-600">Nenhum cliente encontrado.</p>
      )}

      <div className="flex flex-col gap-2">
        {customers.data?.map((customer) => (
          <Link key={customer.id} href={`/organizations/${organizationId}/customers/${customer.id}`}>
            <Card className="flex items-center justify-between transition-shadow hover:shadow-md">
              <div>
                <p className="font-medium text-slate-900">{customer.name}</p>
                <p className="text-sm text-slate-500">{customer.company ?? customer.email ?? '—'}</p>
              </div>
              <Badge value={customer.status} />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
