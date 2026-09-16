'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateCustomer, useCustomers } from '@/lib/customers/use-customers';
import { WRITE_ROLES, type CustomerStatus } from '@/lib/customers/types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FormError } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const createCustomerSchema = z.object({
  name: z.string().min(1, 'Informe um nome'),
  company: z.string().optional(),
  email: z.string().email('E-mail inválido').optional().or(z.literal('')),
  phone: z.string().optional(),
  tags: z.string().optional(),
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
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;
  const [status, setStatus] = useState<CustomerStatus | ''>('');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

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
      {
        name: values.name,
        company: values.company || undefined,
        email: values.email || undefined,
        phone: values.phone || undefined,
        tags: values.tags
          ? values.tags.split(',').map((t) => t.trim()).filter(Boolean)
          : undefined,
      },
      { onSuccess: () => { reset(); setDialogOpen(false); } },
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Clientes</h1>
        {canWrite && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>+ Novo cliente</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo cliente</DialogTitle>
              </DialogHeader>
              <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome</label>
                  <Input placeholder="Nome" {...register('name')} />
                  <FormError message={errors.name?.message} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Empresa (opcional)</label>
                  <Input placeholder="Empresa" {...register('company')} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">E-mail (opcional)</label>
                  <Input placeholder="E-mail" {...register('email')} />
                  <FormError message={errors.email?.message} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Telefone (opcional)</label>
                  <Input placeholder="Telefone" {...register('phone')} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Tags (opcional, separadas por vírgula)
                  </label>
                  <Input placeholder="ex.: vip, indicação" {...register('tags')} />
                </div>
                <FormError message={createCustomer.isError ? (createCustomer.error as ApiError).message : null} />
                <DialogFooter>
                  <Button type="submit" isLoading={createCustomer.isPending}>
                    Criar
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

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
      </div>

      {customers.isLoading && <p className="text-muted-foreground">Carregando clientes…</p>}
      {customers.isSuccess && customers.data.length === 0 && (
        <p className="text-muted-foreground">Nenhum cliente encontrado.</p>
      )}

      {customers.isSuccess && customers.data.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Nome</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.data.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <Link
                      href={`/organizations/${organizationId}/customers/${customer.id}`}
                      className="font-medium text-foreground hover:text-accent-400"
                    >
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-foreground/80">{customer.company ?? '—'}</TableCell>
                  <TableCell className="text-foreground/80">{customer.email ?? customer.phone ?? '—'}</TableCell>
                  <TableCell>
                    {customer.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {customer.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-ink-800 px-2 py-0.5 text-xs text-muted-foreground">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge value={customer.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
