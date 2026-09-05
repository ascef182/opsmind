'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateTask, useTasks, useUpdateTask } from '@/lib/tasks/use-tasks';
import type { Task, TaskStatus } from '@/lib/tasks/types';
import { useCustomers } from '@/lib/customers/use-customers';
import { useMembers } from '@/lib/memberships/use-memberships';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FormError } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const taskFormSchema = z.object({
  title: z.string().min(1, 'Informe um título'),
  description: z.string().optional(),
  customerId: z.string().optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

const STATUS_OPTIONS: Array<{ value: TaskStatus | ''; label: string }> = [
  { value: '', label: 'Todos os status' },
  { value: 'OPEN', label: 'Em aberto' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'DONE', label: 'Concluída' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

const TASK_STATUSES: TaskStatus[] = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'];

export default function TasksPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const tasks = useTasks(organizationId, {
    status: status || undefined,
    customerId: customerFilter || undefined,
  });
  const customers = useCustomers(organizationId);
  const members = useMembers(organizationId);
  const createTask = useCreateTask(organizationId);
  const updateTask = useUpdateTask(organizationId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TaskFormValues>({ resolver: zodResolver(taskFormSchema) });

  function openCreateDialog() {
    setEditingTask(null);
    reset({ title: '', description: '', customerId: '', assigneeId: '', dueDate: '' });
    setDialogOpen(true);
  }

  function openEditDialog(task: Task) {
    setEditingTask(task);
    reset({
      title: task.title,
      description: task.description ?? '',
      customerId: task.customerId ?? '',
      assigneeId: task.assigneeId ?? '',
      dueDate: '',
    });
    setDialogOpen(true);
  }

  const onSubmit = handleSubmit((values) => {
    if (editingTask) {
      updateTask.mutate(
        {
          taskId: editingTask.id,
          input: {
            title: values.title,
            description: values.description || undefined,
            customerId: values.customerId || undefined,
            assigneeId: values.assigneeId || undefined,
          },
        },
        { onSuccess: () => setDialogOpen(false) },
      );
      return;
    }
    createTask.mutate(
      {
        title: values.title,
        description: values.description || undefined,
        customerId: values.customerId || undefined,
        assigneeId: values.assigneeId || undefined,
        dueDate: values.dueDate || undefined,
      },
      { onSuccess: () => setDialogOpen(false) },
    );
  });

  // Editar reaproveita o mesmo Dialog/form de criação — só troca qual mutation
  // é disparada e omite o campo de vencimento (UpdateTaskInput não suporta
  // dueDate, só CreateTaskInput; ver apps/web/lib/tasks/types.ts).
  const mutation = editingTask ? updateTask : createTask;

  const customerName = (customerId: string | null) =>
    customers.data?.find((c) => c.id === customerId)?.name ?? '—';
  const memberName = (userId: string | null) =>
    members.data?.find((m) => m.userId === userId)?.user.name ?? '—';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Tarefas</h1>
        <Button onClick={openCreateDialog}>+ Nova tarefa</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskStatus | '')}
          className="max-w-[180px]"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
          className="max-w-[220px]"
        >
          <option value="">Todos os clientes</option>
          {customers.data?.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </Select>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTask ? 'Editar tarefa' : 'Nova tarefa'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Título</label>
              <Input placeholder="Título" {...register('title')} />
              <FormError message={errors.title?.message} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Descrição (opcional)
              </label>
              <Textarea rows={3} placeholder="Descrição" {...register('description')} />
            </div>
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Cliente (opcional)
                </label>
                <Select {...register('customerId')}>
                  <option value="">Sem cliente vinculado</option>
                  {customers.data?.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Responsável (opcional)
                </label>
                <Select {...register('assigneeId')}>
                  <option value="">Sem responsável</option>
                  {members.data?.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.user.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {!editingTask && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Vencimento (opcional)
                </label>
                <Input type="date" {...register('dueDate')} />
              </div>
            )}
            <FormError message={mutation.isError ? (mutation.error as ApiError).message : null} />
            <DialogFooter>
              <Button type="submit" isLoading={mutation.isPending}>
                {editingTask ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {tasks.isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {tasks.isSuccess && tasks.data.length === 0 && (
        <p className="text-muted-foreground">Nenhuma tarefa encontrada.</p>
      )}

      {tasks.isSuccess && tasks.data.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Título</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.data.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => openEditDialog(task)}
                      className={
                        task.status === 'DONE'
                          ? 'text-muted-foreground line-through hover:text-foreground'
                          : 'font-medium text-foreground hover:text-accent-400'
                      }
                    >
                      {task.title}
                    </button>
                  </TableCell>
                  <TableCell className="text-foreground/80">{customerName(task.customerId)}</TableCell>
                  <TableCell className="text-foreground/80">{memberName(task.assigneeId)}</TableCell>
                  <TableCell className="text-foreground/80">
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString('pt-BR') : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge value={task.status} />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={task.status}
                      onChange={(e) =>
                        updateTask.mutate({ taskId: task.id, input: { status: e.target.value as TaskStatus } })
                      }
                      className="w-40"
                    >
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
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
