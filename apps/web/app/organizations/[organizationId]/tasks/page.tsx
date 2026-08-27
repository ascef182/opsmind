'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateTask, useTasks, useUpdateTask } from '@/lib/tasks/use-tasks';
import type { TaskStatus } from '@/lib/tasks/types';
import { useCustomers } from '@/lib/customers/use-customers';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, FormError } from '@/components/ui/card';

const createTaskSchema = z.object({
  title: z.string().min(1, 'Informe um título'),
  customerId: z.string().optional(),
});

type CreateTaskFormValues = z.infer<typeof createTaskSchema>;

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
  const [showCreateForm, setShowCreateForm] = useState(false);

  const tasks = useTasks(organizationId, { status: status || undefined });
  const customers = useCustomers(organizationId);
  const createTask = useCreateTask(organizationId);
  const updateTask = useUpdateTask(organizationId);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTaskFormValues>({ resolver: zodResolver(createTaskSchema) });

  const onSubmit = handleSubmit((values) => {
    createTask.mutate(
      { title: values.title, customerId: values.customerId || undefined },
      { onSuccess: () => { reset(); setShowCreateForm(false); } },
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | '')} className="max-w-[180px]">
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button variant="secondary" className="ml-auto" onClick={() => setShowCreateForm((v) => !v)}>
          + Nova tarefa
        </Button>
      </div>

      {showCreateForm && (
        <Card>
          <h2 className="font-medium text-slate-900">Nova tarefa</h2>
          <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex-1">
              <Input placeholder="Título" {...register('title')} />
              <FormError message={errors.title?.message} />
            </div>
            <div className="flex-1">
              <Select {...register('customerId')} defaultValue="">
                <option value="">Sem cliente vinculado</option>
                {customers.data?.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" isLoading={createTask.isPending}>
              Criar
            </Button>
          </form>
          <FormError message={createTask.isError ? (createTask.error as ApiError).message : null} />
        </Card>
      )}

      {tasks.isLoading && <p className="text-slate-500">Carregando tarefas…</p>}
      {tasks.isSuccess && tasks.data.length === 0 && <p className="text-slate-600">Nenhuma tarefa encontrada.</p>}

      <div className="flex flex-col gap-2">
        {tasks.data?.map((task) => (
          <Card key={task.id} className="flex items-center justify-between">
            <div>
              <p className={task.status === 'DONE' ? 'text-slate-400 line-through' : 'font-medium text-slate-900'}>
                {task.title}
              </p>
              {task.dueDate && (
                <p className="text-xs text-slate-400">
                  vence em {new Date(task.dueDate).toLocaleDateString('pt-BR')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Badge value={task.status} />
              <Select
                value={task.status}
                onChange={(e) => updateTask.mutate({ taskId: task.id, input: { status: e.target.value as TaskStatus } })}
                className="w-40"
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
