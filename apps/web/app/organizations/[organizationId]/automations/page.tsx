'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { MoreHorizontalIcon } from 'lucide-react';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import {
  useAutomationRuns,
  useAutomations,
  useCreateAutomation,
  useRunAutomationNow,
  useUpdateAutomation,
} from '@/lib/automations/use-automations';
import type { Automation, AutomationTrigger } from '@/lib/automations/types';
import { AUTOMATION_CONDITION_FIELD, AUTOMATION_TRIGGER_LABELS, WRITE_ROLES } from '@/lib/automations/types';
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

const automationFormSchema = z.object({
  name: z.string().min(1, 'Informe o nome').max(120),
  trigger: z.enum(['CUSTOMER_INACTIVE', 'DEAL_STAGE_STALE', 'DEAL_SILENT_FOR']),
  // Único campo numérico do form pros 3 triggers — a chave real de
  // `conditions` (AUTOMATION_CONDITION_FIELD[trigger].key) é resolvida só no
  // submit, nunca um campo zod por trigger. Arquiteturalmente fecha a
  // possibilidade do payload misturar a chave de condição de dois triggers
  // diferentes, já que só existe uma chave no form state.
  conditionValue: z.coerce.number().int().optional(),
  createTask: z.boolean().optional(),
  notify: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
type AutomationFormValues = z.infer<typeof automationFormSchema>;

const DEFAULT_VALUES: AutomationFormValues = {
  name: '',
  trigger: 'CUSTOMER_INACTIVE',
  conditionValue: undefined,
  createTask: true,
  notify: true,
  enabled: true,
};

export default function AutomationsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;

  const automations = useAutomations(organizationId);
  const createAutomation = useCreateAutomation(organizationId);
  const updateAutomation = useUpdateAutomation(organizationId);
  const runAutomationNow = useRunAutomationNow(organizationId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [historyAutomation, setHistoryAutomation] = useState<Automation | null>(null);

  const automationRuns = useAutomationRuns(organizationId, historyAutomation?.id ?? '');

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<AutomationFormValues>({ resolver: zodResolver(automationFormSchema), defaultValues: DEFAULT_VALUES });

  // Único campo condicional-por-tipo do form até agora: rótulo e a chave de
  // `conditions` mudam com o trigger escolhido, então precisa de `watch`
  // pra re-renderizar o label a cada troca do <select> — sem precedente
  // direto no resto do app, que é sempre 1 campo = 1 chave fixa.
  const watchedTrigger = watch('trigger');
  const conditionField = AUTOMATION_CONDITION_FIELD[watchedTrigger];

  function openCreateDialog() {
    setEditingAutomation(null);
    reset(DEFAULT_VALUES);
    setDialogOpen(true);
  }

  function openEditDialog(automation: Automation) {
    setEditingAutomation(automation);
    reset({
      name: automation.name,
      trigger: automation.trigger,
      conditionValue: automation.conditions[AUTOMATION_CONDITION_FIELD[automation.trigger].key] as number | undefined,
      createTask: automation.actions.createTask ?? false,
      notify: automation.actions.notify ?? false,
      enabled: automation.enabled,
    });
    setDialogOpen(true);
  }

  // Editar reaproveita o mesmo Dialog/form de criação — mesmo padrão de
  // prospecting-targets/page.tsx: só troca qual mutation dispara no submit.
  const mutation = editingAutomation ? updateAutomation : createAutomation;

  const onSubmit = handleSubmit((values) => {
    const field = AUTOMATION_CONDITION_FIELD[values.trigger];
    const conditions = values.conditionValue !== undefined ? { [field.key]: values.conditionValue } : undefined;
    const actions = { createTask: values.createTask, notify: values.notify };

    if (editingAutomation) {
      updateAutomation.mutate(
        { automationId: editingAutomation.id, input: { name: values.name, conditions, actions, enabled: values.enabled } },
        { onSuccess: () => setDialogOpen(false) },
      );
      return;
    }
    createAutomation.mutate(
      { name: values.name, trigger: values.trigger, conditions, actions, enabled: values.enabled },
      { onSuccess: () => setDialogOpen(false) },
    );
  });

  function toggleEnabled(automation: Automation) {
    updateAutomation.mutate({ automationId: automation.id, input: { enabled: !automation.enabled } });
  }

  // Reflete a limitação real de `AutomationsService.runNow` (apps/api) — não
  // é só esconder o botão por estética, as duas mensagens abaixo são as
  // mesmas que o backend devolveria se a chamada fosse tentada mesmo assim.
  function runNowDisabledReason(automation: Automation): string | null {
    if (automation.trigger !== 'CUSTOMER_INACTIVE') {
      return 'Execução manual só suporta automações de cliente inativo';
    }
    if (!automation.enabled) {
      return 'Automação está desabilitada';
    }
    return null;
  }

  function handleRunNow(automation: Automation) {
    runAutomationNow.mutate(automation.id, {
      onSuccess: (result) =>
        toast.success(
          result.enqueued > 0
            ? `Execução enfileirada para ${result.enqueued} cliente(s).`
            : 'Nenhum cliente qualificado agora.',
        ),
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Não foi possível executar agora.'),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Automações</h1>
        {canWrite && <Button onClick={openCreateDialog}>+ Nova automação</Button>}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAutomation ? 'Editar automação' : 'Nova automação'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nome</label>
              <Input placeholder="Ex.: Reengajar clientes inativos" {...register('name')} />
              <FormError message={errors.name?.message} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Gatilho</label>
              <Select {...register('trigger')} disabled={!!editingAutomation}>
                {(Object.keys(AUTOMATION_TRIGGER_LABELS) as AutomationTrigger[]).map((trigger) => (
                  <option key={trigger} value={trigger}>
                    {AUTOMATION_TRIGGER_LABELS[trigger]}
                  </option>
                ))}
              </Select>
              {editingAutomation && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Trocar o gatilho de uma automação existente não é suportado.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{conditionField.label}</label>
              <Input type="number" {...register('conditionValue')} />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" className="h-4 w-4 rounded border-input bg-input/30" {...register('createTask')} />
                Criar tarefa
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" className="h-4 w-4 rounded border-input bg-input/30" {...register('notify')} />
                Notificar
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" className="h-4 w-4 rounded border-input bg-input/30" {...register('enabled')} />
                Habilitada
              </label>
            </div>
            <FormError message={mutation.isError ? (mutation.error as ApiError).message : null} />
            <DialogFooter>
              <Button type="submit" isLoading={mutation.isPending}>
                {editingAutomation ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {automations.isLoading && <p className="text-muted-foreground">Carregando automações…</p>}
      {automations.isSuccess && automations.data.length === 0 && (
        <p className="text-muted-foreground">Nenhuma automação cadastrada ainda.</p>
      )}

      {automations.isSuccess && automations.data.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Nome</TableHead>
                <TableHead>Gatilho</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criada em</TableHead>
                {canWrite && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {automations.data.map((automation) => {
                const runNowReason = runNowDisabledReason(automation);
                const runNowPending = runAutomationNow.isPending && runAutomationNow.variables === automation.id;
                return (
                  <TableRow key={automation.id}>
                    <TableCell className="font-medium text-foreground">{automation.name}</TableCell>
                    <TableCell>
                      <Badge value={automation.trigger} />
                    </TableCell>
                    <TableCell>
                      <Badge value={automation.enabled ? 'ACTIVE' : 'INACTIVE'} />
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {new Date(automation.createdAt).toLocaleString('pt-BR')}
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
                            <DropdownMenuItem onSelect={() => openEditDialog(automation)}>Editar</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => toggleEnabled(automation)}>
                              {automation.enabled ? 'Desativar' : 'Ativar'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={runNowReason !== null || runNowPending}
                              title={runNowReason ?? undefined}
                              onSelect={() => handleRunNow(automation)}
                            >
                              {runNowPending ? 'Executando…' : 'Executar agora'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setHistoryAutomation(automation)}>
                              Ver histórico
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={historyAutomation !== null} onOpenChange={(open) => !open && setHistoryAutomation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Histórico — {historyAutomation?.name}</DialogTitle>
          </DialogHeader>
          {automationRuns.isLoading && <p className="text-muted-foreground">Carregando histórico…</p>}
          {automationRuns.isSuccess && automationRuns.data.length === 0 && (
            <p className="text-muted-foreground">Nenhuma execução registrada ainda.</p>
          )}
          {automationRuns.isSuccess && automationRuns.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {automationRuns.data.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Badge value={run.status} />
                    </TableCell>
                    <TableCell className="text-foreground/80">
                      {new Date(run.createdAt).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-foreground/80">
                      {run.errorMessage ?? (run.result ? JSON.stringify(run.result) : '—')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
