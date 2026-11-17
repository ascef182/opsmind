'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, FormError } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatUsd } from '@/components/revenue/revenue-ui';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useRevenueSettings, useUpdateRevenueSettings } from '@/lib/revenue/use-revenue';
import { REVENUE_SETTINGS_ROLES, type RevenueSettings } from '@/lib/revenue/types';
import type { ApiError } from '@/lib/api-client';

// Mesmos tetos de `UpdateRevenueSettingsDto` na API.
const limitsSchema = z.object({
  dailySendLimit: z.coerce.number().int().min(0).max(500),
  dailyResearchLimit: z.coerce.number().int().min(0).max(2000),
  engineMonthlyBudgetUsd: z.coerce.number().min(0).max(100000),
  defaultOutreachCountry: z.enum(['US', 'BR']),
});
type LimitsForm = z.infer<typeof limitsSchema>;

export default function RevenueSettingsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const settings = useRevenueSettings(organizationId);
  const { membership } = useCurrentMembership(organizationId);
  const canEdit = membership ? (REVENUE_SETTINGS_ROLES as readonly string[]).includes(membership.role) : false;

  if (settings.isLoading) return <Skeleton className="h-80 w-full" />;
  if (settings.isError) return <FormError message={(settings.error as ApiError).message} />;
  if (!settings.data) return null;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {!canEdit && (
        <p className="text-sm text-muted-foreground">Somente donos e administradores alteram estas configurações.</p>
      )}
      <OutreachPauseCard organizationId={organizationId} settings={settings.data} canEdit={canEdit} />
      <LimitsCard organizationId={organizationId} settings={settings.data} canEdit={canEdit} />
    </div>
  );
}

function OutreachPauseCard({
  organizationId,
  settings,
  canEdit,
}: {
  organizationId: string;
  settings: RevenueSettings;
  canEdit: boolean;
}) {
  const update = useUpdateRevenueSettings(organizationId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');

  const pause = () =>
    update.mutate(
      { outreachPaused: true, ...(reason.trim() ? { outreachPausedReason: reason.trim() } : {}) },
      { onSuccess: () => toast.success('Envio de outreach pausado') },
    );
  const release = () =>
    update.mutate({ outreachPaused: false }, { onSuccess: () => toast.success('Envio de outreach liberado') });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium" id="outreach-sending-label">
            Envio de outreach
          </h2>
          <p className="text-sm text-muted-foreground">
            {settings.outreachPaused
              ? 'Pausado. Rascunhos continuam sendo gerados e aprovados, mas nenhum e-mail sai.'
              : 'Liberado. Mensagens aprovadas podem ser enviadas, dentro do limite diário.'}
          </p>
          {settings.outreachPaused && settings.outreachPausedReason && (
            <p className="text-sm text-muted-foreground">Motivo: {settings.outreachPausedReason}</p>
          )}
        </div>
        <Switch
          aria-labelledby="outreach-sending-label"
          checked={!settings.outreachPaused}
          disabled={!canEdit || update.isPending}
          onCheckedChange={(enabled) => (enabled ? setConfirmOpen(true) : pause())}
        />
      </div>

      {settings.globalPause && (
        <p className="rounded-md border border-border bg-ink-800 px-3 py-2 text-sm">
          O envio também está bloqueado para todas as organizações desta instância (OUTREACH_GLOBAL_PAUSE). Liberar
          aqui não muda isso.
        </p>
      )}

      {canEdit && !settings.outreachPaused && (
        <div className="flex flex-col gap-1">
          <label htmlFor="pause-reason" className="text-xs font-medium text-muted-foreground">
            Motivo da pausa (opcional, registrado na auditoria)
          </label>
          <Input
            id="pause-reason"
            value={reason}
            maxLength={280}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: taxa de bounce subiu"
          />
        </div>
      )}

      <FormError message={update.isError ? (update.error as ApiError).message : null} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Liberar envio de outreach?</AlertDialogTitle>
            <AlertDialogDescription>
              Mensagens já aprovadas poderão ser enviadas por e-mail, até {settings.dailySendLimit} por dia. Antes de
              liberar, confirme que o domínio de envio está autenticado (SPF, DKIM, DMARC) e que o endereço físico da
              organização está preenchido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter pausado</AlertDialogCancel>
            <AlertDialogAction onClick={release}>Liberar envio</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function LimitsCard({
  organizationId,
  settings,
  canEdit,
}: {
  organizationId: string;
  settings: RevenueSettings;
  canEdit: boolean;
}) {
  const update = useUpdateRevenueSettings(organizationId);
  const form = useForm<LimitsForm>({
    resolver: zodResolver(limitsSchema),
    defaultValues: {
      dailySendLimit: settings.dailySendLimit,
      dailyResearchLimit: settings.dailyResearchLimit,
      engineMonthlyBudgetUsd: settings.engineMonthlyBudgetUsd,
      defaultOutreachCountry: settings.defaultOutreachCountry === 'BR' ? 'BR' : 'US',
    },
  });
  const { reset } = form;

  useEffect(() => {
    reset({
      dailySendLimit: settings.dailySendLimit,
      dailyResearchLimit: settings.dailyResearchLimit,
      engineMonthlyBudgetUsd: settings.engineMonthlyBudgetUsd,
      defaultOutreachCountry: settings.defaultOutreachCountry === 'BR' ? 'BR' : 'US',
    });
  }, [settings, reset]);

  const onSubmit = form.handleSubmit((values) =>
    update.mutate(values, { onSuccess: () => toast.success('Limites atualizados') }),
  );
  const errors = form.formState.errors;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">Limites e orçamento</h2>
        <p className="text-sm text-muted-foreground">
          Quando o gasto do mês chega ao teto do engine, a pesquisa diária e os rascunhos automáticos param. Avisos saem
          a 50%, 80% e 100%.
        </p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field id="engineMonthlyBudgetUsd" label="Teto mensal do engine (US$)" error={errors.engineMonthlyBudgetUsd?.message}>
          <Input
            id="engineMonthlyBudgetUsd"
            type="number"
            step="0.01"
            min={0}
            disabled={!canEdit}
            {...form.register('engineMonthlyBudgetUsd')}
          />
        </Field>
        <Field id="dailySendLimit" label="E-mails de outreach por dia" error={errors.dailySendLimit?.message}>
          <Input id="dailySendLimit" type="number" min={0} disabled={!canEdit} {...form.register('dailySendLimit')} />
        </Field>
        <Field id="dailyResearchLimit" label="Negócios pesquisados por dia" error={errors.dailyResearchLimit?.message}>
          <Input
            id="dailyResearchLimit"
            type="number"
            min={0}
            disabled={!canEdit}
            {...form.register('dailyResearchLimit')}
          />
        </Field>
        <Field id="defaultOutreachCountry" label="Mercado padrão" error={errors.defaultOutreachCountry?.message}>
          <Select id="defaultOutreachCountry" disabled={!canEdit} {...form.register('defaultOutreachCountry')}>
            <option value="US">Estados Unidos</option>
            <option value="BR">Brasil</option>
          </Select>
        </Field>
        {canEdit && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" isLoading={update.isPending} disabled={!form.formState.isDirty}>
              Salvar limites
            </Button>
            <span className="text-xs text-muted-foreground">Atual: teto {formatUsd(settings.engineMonthlyBudgetUsd)}/mês</span>
          </div>
        )}
        <div className="sm:col-span-2">
          <FormError message={update.isError ? (update.error as ApiError).message : null} />
        </div>
      </form>
    </Card>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-negative-500">{error}</p>}
    </div>
  );
}
