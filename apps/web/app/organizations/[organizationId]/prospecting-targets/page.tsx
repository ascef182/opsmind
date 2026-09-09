'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MoreHorizontalIcon } from 'lucide-react';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import {
  useCreateProspectingTarget,
  useProspectingTargets,
  useRemoveProspectingTarget,
  useUpdateProspectingTarget,
} from '@/lib/leads/use-prospecting-targets';
import type { ProspectingTarget } from '@/lib/leads/types';
import { AUTOMATABLE_SOURCE_TYPES, SCRAPE_SOURCE_LABELS, WRITE_ROLES } from '@/lib/leads/types';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FormError } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// `sourceType` só oferece as fontes automatizáveis (nunca MANUAL) — mesma
// regra de create-scrape-job.dto.ts/create-prospecting-target.dto.ts,
// espelhada aqui como em leads/page.tsx (formulário de "Nova busca").
const targetFormSchema = z.object({
  city: z.string().min(1, 'Informe a cidade').max(120),
  state: z.string().min(1, 'Informe o estado').max(60),
  businessType: z.string().min(1, 'Informe o tipo de negócio').max(120),
  sourceType: z.enum(['APIFY_GOOGLE_MAPS', 'EXPLORIUM_BUSINESS_SEARCH', 'CAMOFOX_GOOGLE_SEARCH', 'CAMOFOX_REDDIT_SEARCH']),
  onlyWithoutWebsite: z.boolean().optional(),
  // Sem `.optional()` nos dois campos numéricos, mesmo racional do form de
  // scrape job em leads/page.tsx: defaultValues sempre populam algo, evita
  // o edge case de `z.coerce.number()` sobre string vazia.
  limit: z.coerce.number().int().min(1, 'Mínimo 1').max(200, 'Máximo 200'),
  cooldownDays: z.coerce.number().int().min(1, 'Mínimo 1').max(90, 'Máximo 90'),
  isActive: z.boolean().optional(),
});
type TargetFormValues = z.infer<typeof targetFormSchema>;

const DEFAULT_VALUES: TargetFormValues = {
  city: '',
  state: '',
  businessType: '',
  sourceType: 'APIFY_GOOGLE_MAPS',
  onlyWithoutWebsite: true,
  limit: 50,
  cooldownDays: 7,
  isActive: true,
};

export default function ProspectingTargetsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;

  const targets = useProspectingTargets(organizationId);
  const createTarget = useCreateProspectingTarget(organizationId);
  const updateTarget = useUpdateProspectingTarget(organizationId);
  const removeTarget = useRemoveProspectingTarget(organizationId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<ProspectingTarget | null>(null);
  const [removingTarget, setRemovingTarget] = useState<ProspectingTarget | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TargetFormValues>({ resolver: zodResolver(targetFormSchema), defaultValues: DEFAULT_VALUES });

  function openCreateDialog() {
    setEditingTarget(null);
    reset(DEFAULT_VALUES);
    setDialogOpen(true);
  }

  function openEditDialog(target: ProspectingTarget) {
    setEditingTarget(target);
    reset({
      city: target.city,
      state: target.state,
      businessType: target.businessType,
      sourceType: target.sourceType as TargetFormValues['sourceType'],
      onlyWithoutWebsite: target.onlyWithoutWebsite,
      limit: target.limit,
      cooldownDays: target.cooldownDays,
      isActive: target.isActive,
    });
    setDialogOpen(true);
  }

  // Editar reaproveita o mesmo Dialog/form de criação — mesmo padrão de
  // tasks/page.tsx: só troca qual mutation dispara no submit.
  const mutation = editingTarget ? updateTarget : createTarget;

  const onSubmit = handleSubmit((values) => {
    if (editingTarget) {
      updateTarget.mutate(
        { targetId: editingTarget.id, input: values },
        { onSuccess: () => setDialogOpen(false) },
      );
      return;
    }
    createTarget.mutate(values, { onSuccess: () => setDialogOpen(false) });
  });

  function confirmRemove() {
    if (!removingTarget) return;
    removeTarget.mutate(removingTarget.id, { onSuccess: () => setRemovingTarget(null) });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Alvos de prospecção</h1>
        {canWrite && <Button onClick={openCreateDialog}>+ Novo alvo</Button>}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTarget ? 'Editar alvo de prospecção' : 'Novo alvo de prospecção'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Fonte</label>
              <Select {...register('sourceType')}>
                {AUTOMATABLE_SOURCE_TYPES.map((sourceType) => (
                  <option key={sourceType} value={sourceType}>
                    {SCRAPE_SOURCE_LABELS[sourceType]}
                  </option>
                ))}
              </Select>
              <FormError message={errors.sourceType?.message} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Cidade</label>
                <Input placeholder="São Paulo" {...register('city')} />
                <FormError message={errors.city?.message} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Estado</label>
                <Input placeholder="SP" {...register('state')} />
                <FormError message={errors.state?.message} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo de negócio</label>
              <Input placeholder="restaurante, dentista, oficina…" {...register('businessType')} />
              <FormError message={errors.businessType?.message} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Limite de leads por busca</label>
                <Input type="number" min={1} max={200} {...register('limit')} />
                <FormError message={errors.limit?.message} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Intervalo entre buscas (dias)</label>
                <Input type="number" min={1} max={90} {...register('cooldownDays')} />
                <FormError message={errors.cooldownDays?.message} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input bg-input/30"
                  {...register('onlyWithoutWebsite')}
                />
                Só negócios sem site
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" className="h-4 w-4 rounded border-input bg-input/30" {...register('isActive')} />
                Alvo ativo
              </label>
            </div>
            <FormError message={mutation.isError ? (mutation.error as ApiError).message : null} />
            <DialogFooter>
              <Button type="submit" isLoading={mutation.isPending}>
                {editingTarget ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {targets.isLoading && <p className="text-muted-foreground">Carregando alvos…</p>}
      {targets.isSuccess && targets.data.length === 0 && (
        <p className="text-muted-foreground">Nenhum alvo de prospecção cadastrado ainda.</p>
      )}

      {targets.isSuccess && targets.data.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Cidade/Estado</TableHead>
                <TableHead>Tipo de negócio</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead>Só sem site</TableHead>
                <TableHead>Limite</TableHead>
                <TableHead>Cooldown</TableHead>
                <TableHead>Status</TableHead>
                {canWrite && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.data.map((target) => (
                <TableRow key={target.id}>
                  <TableCell className="font-medium text-foreground">
                    {target.city}/{target.state}
                  </TableCell>
                  <TableCell className="text-foreground/80">{target.businessType}</TableCell>
                  <TableCell className="text-foreground/80">{SCRAPE_SOURCE_LABELS[target.sourceType]}</TableCell>
                  <TableCell className="text-foreground/80">{target.onlyWithoutWebsite ? 'Sim' : 'Não'}</TableCell>
                  <TableCell className="text-foreground/80">{target.limit}</TableCell>
                  <TableCell className="text-foreground/80">
                    {target.cooldownDays} dia{target.cooldownDays === 1 ? '' : 's'}
                  </TableCell>
                  <TableCell>
                    <Badge value={target.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontalIcon />
                            <span className="sr-only">Ações</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEditDialog(target)}>Editar</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setRemovingTarget(target)}>
                            Remover
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={removingTarget !== null} onOpenChange={(open) => !open && setRemovingTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover alvo de prospecção</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que quer remover o alvo{' '}
            <span className="text-foreground">
              {removingTarget?.businessType} em {removingTarget?.city}/{removingTarget?.state}
            </span>
            ? Essa ação não pode ser desfeita.
          </p>
          <FormError message={removeTarget.isError ? (removeTarget.error as ApiError).message : null} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemovingTarget(null)}>
              Cancelar
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:opacity-90"
              isLoading={removeTarget.isPending}
              onClick={confirmRemove}
            >
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
