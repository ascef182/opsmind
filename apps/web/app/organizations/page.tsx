'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRequireAuth } from '@/lib/auth/use-require-auth';
import { useCreateOrganization, useOrganizations } from '@/lib/organizations/use-organizations';
import { ApiError } from '@/lib/api-client';
import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, FormError } from '@/components/ui/card';

const createOrgSchema = z.object({
  name: z.string().min(1, 'Informe um nome').max(120),
});

type CreateOrgFormValues = z.infer<typeof createOrgSchema>;

export default function OrganizationsPage() {
  const { checked } = useRequireAuth();
  const organizations = useOrganizations();
  const createOrganization = useCreateOrganization();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateOrgFormValues>({ resolver: zodResolver(createOrgSchema) });

  if (!checked) {
    return null;
  }

  const onSubmit = handleSubmit((values) => {
    createOrganization.mutate(values, {
      onSuccess: () => {
        reset();
        setShowCreateForm(false);
      },
    });
  });

  const hasOrganizations = (organizations.data?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader title="Suas organizações" />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
        {organizations.isLoading && <p className="text-slate-500">Carregando organizações…</p>}

        {organizations.isSuccess && (
          <div className="flex flex-col gap-3">
            {organizations.data.map((org) => (
              <Link key={org.id} href={`/organizations/${org.id}/dashboard`}>
                <Card className="transition-shadow hover:shadow-md">
                  <p className="font-medium text-slate-900">{org.name}</p>
                  <p className="text-sm text-slate-500">/{org.slug}</p>
                </Card>
              </Link>
            ))}
            {!hasOrganizations && !showCreateForm && (
              <p className="text-slate-600">
                Você ainda não faz parte de nenhuma organização. Crie a primeira abaixo.
              </p>
            )}
          </div>
        )}

        {!showCreateForm && (
          <Button variant="secondary" className="self-start" onClick={() => setShowCreateForm(true)}>
            + Nova organização
          </Button>
        )}

        {showCreateForm && (
          <Card>
            <h2 className="font-medium text-slate-900">Criar organização</h2>
            <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
              <div>
                <Input placeholder="Nome da organização" {...register('name')} />
                <FormError message={errors.name?.message} />
              </div>
              <FormError
                message={createOrganization.isError ? (createOrganization.error as ApiError).message : null}
              />
              <div className="flex gap-3">
                <Button type="submit" isLoading={createOrganization.isPending}>
                  Criar
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowCreateForm(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </Card>
        )}
      </main>
    </div>
  );
}
