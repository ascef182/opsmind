'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useCustomers } from '@/lib/customers/use-customers';
import { useCreateDeal, useDeals, useMoveDealStage } from '@/lib/deals/use-deals';
import {
  DEAL_STAGES,
  DEAL_STAGE_LABELS,
  DEAL_STAGE_TRANSITIONS,
  WRITE_ROLES,
  formatCurrency,
  type Deal,
  type DealStage,
} from '@/lib/deals/types';
import { ApiError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormError } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const createDealSchema = z.object({
  customerId: z.string().min(1, 'Escolha um cliente'),
  title: z.string().min(1, 'Informe um título').max(200),
  value: z.coerce.number().min(0, 'Valor não pode ser negativo'),
  currency: z.string().max(10).optional(),
  expectedCloseDate: z.string().optional(),
});
type CreateDealFormValues = z.infer<typeof createDealSchema>;

function DealCard({
  deal,
  customerName,
  organizationId,
  canWrite,
}: {
  deal: Deal;
  customerName: string;
  organizationId: string;
  canWrite: boolean;
}) {
  const moveStage = useMoveDealStage(organizationId, deal.id);
  const nextStages = DEAL_STAGE_TRANSITIONS[deal.stage];

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 text-sm">
      <Link
        href={`/organizations/${organizationId}/deals/${deal.id}`}
        className="font-medium text-foreground hover:text-accent-400"
      >
        {deal.title}
      </Link>
      <span className="text-xs text-muted-foreground">{customerName}</span>
      <span className="font-medium text-foreground">{formatCurrency(deal.value, deal.currency)}</span>
      {deal.expectedCloseDate && (
        <span className="text-xs text-muted-foreground">
          Fecha em {new Date(deal.expectedCloseDate).toLocaleDateString('pt-BR')}
        </span>
      )}
      {canWrite && nextStages.length > 0 && (
        <Select
          value=""
          disabled={moveStage.isPending}
          onChange={(e) => {
            const stage = e.target.value as DealStage;
            if (!stage) return;
            if (stage === 'LOST') {
              const reason = window.prompt('Motivo da perda:');
              if (!reason) return;
              moveStage.mutate({ stage, lostReason: reason });
              return;
            }
            moveStage.mutate({ stage });
          }}
          className="mt-1"
        >
          <option value="">Mover para…</option>
          {nextStages.map((stage) => (
            <option key={stage} value={stage}>
              {DEAL_STAGE_LABELS[stage]}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

export default function DealsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const searchParams = useSearchParams();
  const prefilledCustomerId = searchParams.get('customerId');
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;

  const [dialogOpen, setDialogOpen] = useState(false);
  // Abre o diálogo já com o cliente selecionado quando chega de
  // "+ Novo negócio" na página de detalhe do cliente (?customerId=...).
  useEffect(() => {
    if (prefilledCustomerId && canWrite) {
      setDialogOpen(true);
    }
  }, [prefilledCustomerId, canWrite]);
  const deals = useDeals(organizationId);
  const customers = useCustomers(organizationId);
  const createDeal = useCreateDeal(organizationId);

  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers.data ?? []) {
      map.set(customer.id, customer.company ?? customer.name);
    }
    return map;
  }, [customers.data]);

  const dealsByStage = useMemo(() => {
    const map = new Map<DealStage, Deal[]>(DEAL_STAGES.map((stage) => [stage, []]));
    for (const deal of deals.data ?? []) {
      map.get(deal.stage)?.push(deal);
    }
    return map;
  }, [deals.data]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateDealFormValues>({
    resolver: zodResolver(createDealSchema),
    defaultValues: { customerId: prefilledCustomerId ?? '', title: '', value: 0 },
  });

  const onSubmit = handleSubmit((values) => {
    createDeal.mutate(
      {
        customerId: values.customerId,
        title: values.title,
        value: values.value,
        currency: values.currency || undefined,
        expectedCloseDate: values.expectedCloseDate || undefined,
      },
      { onSuccess: () => { reset(); setDialogOpen(false); } },
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Negócios</h1>
        {canWrite && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>+ Novo negócio</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo negócio</DialogTitle>
                <DialogDescription>
                  Cria um negócio em negociação para um cliente, sempre no estágio de qualificação.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Cliente</label>
                  <Select {...register('customerId')}>
                    <option value="">Selecione…</option>
                    {customers.data?.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.company ?? customer.name}
                      </option>
                    ))}
                  </Select>
                  {errors.customerId && <p className="mt-1 text-xs text-negative-500">{errors.customerId.message}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Título</label>
                  <Input placeholder="Contrato de manutenção anual" {...register('title')} />
                  {errors.title && <p className="mt-1 text-xs text-negative-500">{errors.title.message}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Valor</label>
                    <Input type="number" min={0} step="0.01" placeholder="5000" {...register('value')} />
                    {errors.value && <p className="mt-1 text-xs text-negative-500">{errors.value.message}</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Moeda</label>
                    <Input placeholder="BRL" {...register('currency')} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Previsão de fechamento
                  </label>
                  <Input type="date" {...register('expectedCloseDate')} />
                </div>
                <FormError message={createDeal.isError ? (createDeal.error as ApiError).message : null} />
                <DialogFooter>
                  <Button type="submit" disabled={createDeal.isPending}>
                    {createDeal.isPending ? 'Criando…' : 'Criar negócio'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {deals.isLoading && <p className="text-muted-foreground">Carregando negócios…</p>}

      {deals.isSuccess && (
        <div className="grid grid-cols-1 gap-4 overflow-x-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {DEAL_STAGES.map((stage) => {
            const stageDeals = dealsByStage.get(stage) ?? [];
            return (
              <div key={stage} className="flex min-w-[220px] flex-col gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <Badge value={stage} />
                  <span className="text-xs text-muted-foreground">{stageDeals.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {stageDeals.length === 0 && (
                    <p className="text-xs text-muted-foreground">Nenhum negócio.</p>
                  )}
                  {stageDeals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      customerName={customerNameById.get(deal.customerId) ?? '—'}
                      organizationId={organizationId}
                      canWrite={canWrite}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
