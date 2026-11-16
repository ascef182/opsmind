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
  useCreateRedditWatchTopic,
  useRedditWatchTopics,
  useRemoveRedditWatchTopic,
  useRunRedditWatchTopicNow,
  useUpdateRedditWatchTopic,
} from '@/lib/market-opportunities/use-reddit-watch-topics';
import { WRITE_ROLES, type RedditWatchTopic } from '@/lib/market-opportunities/types';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

const topicFormSchema = z.object({
  query: z.string().min(1, 'Informe o termo de busca').max(200),
  subreddit: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});
type TopicFormValues = z.infer<typeof topicFormSchema>;

const DEFAULT_VALUES: TopicFormValues = { query: '', subreddit: '', isActive: true };

export default function RedditWatchTopicsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const canWrite = membership ? WRITE_ROLES.includes(membership.role) : false;

  const topics = useRedditWatchTopics(organizationId);
  const createTopic = useCreateRedditWatchTopic(organizationId);
  const updateTopic = useUpdateRedditWatchTopic(organizationId);
  const removeTopic = useRemoveRedditWatchTopic(organizationId);
  const runNow = useRunRedditWatchTopicNow(organizationId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<RedditWatchTopic | null>(null);
  const [removingTopic, setRemovingTopic] = useState<RedditWatchTopic | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TopicFormValues>({ resolver: zodResolver(topicFormSchema), defaultValues: DEFAULT_VALUES });

  function openCreateDialog() {
    setEditingTopic(null);
    reset(DEFAULT_VALUES);
    setDialogOpen(true);
  }

  function openEditDialog(topic: RedditWatchTopic) {
    setEditingTopic(topic);
    reset({
      query: topic.query,
      subreddit: topic.subreddit ?? '',
      isActive: topic.isActive,
    });
    setDialogOpen(true);
  }

  // Editar reaproveita o mesmo Dialog/form de criação — mesmo padrão de
  // prospecting-targets/page.tsx: só troca qual mutation dispara no submit.
  const mutation = editingTopic ? updateTopic : createTopic;

  const onSubmit = handleSubmit((values) => {
    if (editingTopic) {
      // EDIÇÃO: `subreddit` vazio precisa virar `null` explícito no PATCH —
      // `undefined` faria a chave desaparecer do JSON e o backend nunca
      // tocaria no campo, deixando um `subreddit` antigo "preso" mesmo com o
      // form mostrando vazio (bug corrigido nesta rodada).
      const payload = { ...values, subreddit: values.subreddit?.trim() ? values.subreddit.trim() : null };
      updateTopic.mutate({ topicId: editingTopic.id, input: payload }, { onSuccess: () => setDialogOpen(false) });
      return;
    }
    // CRIAÇÃO: pode seguir omitindo — `subreddit` ausente = busca ampla,
    // mesmo tratamento do form embutido em market-opportunities/page.tsx.
    const payload = { ...values, subreddit: values.subreddit?.trim() ? values.subreddit.trim() : undefined };
    createTopic.mutate(payload, { onSuccess: () => setDialogOpen(false) });
  });

  function handleRunNow(topic: RedditWatchTopic) {
    runNow.mutate(topic.id, {
      onSuccess: () => toast.success('Verificação iniciada — o resultado aparece aqui em instantes.'),
      onError: () => toast.error('Não foi possível iniciar a verificação agora.'),
    });
  }

  function confirmRemove() {
    if (!removingTopic) return;
    removeTopic.mutate(removingTopic.id, { onSuccess: () => setRemovingTopic(null) });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Monitoramento de tópicos no Reddit</h1>
        {canWrite && <Button onClick={openCreateDialog}>+ Novo tópico</Button>}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTopic ? 'Editar tópico monitorado' : 'Novo tópico monitorado'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Termo de busca</label>
              <Input placeholder="ex.: 'problema com agendamento'" {...register('query')} />
              <FormError message={errors.query?.message} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Subreddit (opcional)</label>
              <Input placeholder="ex.: smallbusiness" {...register('subreddit')} />
              <FormError message={errors.subreddit?.message} />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" className="h-4 w-4 rounded border-input bg-input/30" {...register('isActive')} />
                Tópico ativo
              </label>
            </div>
            <FormError message={mutation.isError ? (mutation.error as ApiError).message : null} />
            <DialogFooter>
              <Button type="submit" isLoading={mutation.isPending}>
                {editingTopic ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {topics.isLoading && <p className="text-muted-foreground">Carregando tópicos…</p>}
      {topics.isSuccess && topics.data.length === 0 && (
        <p className="text-muted-foreground">Nenhum tópico monitorado ainda.</p>
      )}

      {topics.isSuccess && topics.data.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Query</TableHead>
                <TableHead>Subreddit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Último scan</TableHead>
                <TableHead>Criado em</TableHead>
                {canWrite && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {topics.data.map((topic) => (
                <TableRow key={topic.id}>
                  <TableCell className="font-medium text-foreground">{topic.query}</TableCell>
                  <TableCell className="text-foreground/80">{topic.subreddit ? `r/${topic.subreddit}` : '—'}</TableCell>
                  <TableCell>
                    <Badge value={topic.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  </TableCell>
                  <TableCell className="text-foreground/80">
                    {topic.lastScanStatus ? <Badge value={topic.lastScanStatus} /> : '—'}
                  </TableCell>
                  <TableCell className="text-foreground/80">
                    {new Date(topic.createdAt).toLocaleDateString('pt-BR')}
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
                          <DropdownMenuItem
                            disabled={runNow.isPending && runNow.variables === topic.id}
                            onSelect={() => handleRunNow(topic)}
                          >
                            {runNow.isPending && runNow.variables === topic.id ? 'Verificando…' : 'Executar agora'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => openEditDialog(topic)}>Editar</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setRemovingTopic(topic)}>
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

      <Dialog open={removingTopic !== null} onOpenChange={(open) => !open && setRemovingTopic(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover tópico monitorado</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que quer remover o tópico <span className="text-foreground">{removingTopic?.query}</span>?
            Essa ação não pode ser desfeita.
          </p>
          <FormError message={removeTopic.isError ? (removeTopic.error as ApiError).message : null} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemovingTopic(null)}>
              Cancelar
            </Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:opacity-90"
              isLoading={removeTopic.isPending}
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
