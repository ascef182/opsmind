'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUpdateCampaign } from '@/lib/harvey/use-harvey';
import { WEEKDAYS, minutesToTime, timeToMinutes, type Campaign } from '@/lib/harvey/types';
import type { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface FormState {
  dailyResearchGoal: number;
  dailyQualifiedGoal: number;
  dailyOutreachGoal: number;
  workingDays: number[];
  start: string;
  end: string;
  timezone: string;
}

function toForm(campaign: Campaign): FormState {
  return {
    dailyResearchGoal: campaign.dailyResearchGoal,
    dailyQualifiedGoal: campaign.dailyQualifiedGoal,
    dailyOutreachGoal: campaign.dailyOutreachGoal,
    workingDays: campaign.workingDays,
    start: minutesToTime(campaign.workStartMinute),
    end: minutesToTime(campaign.workEndMinute),
    timezone: campaign.timezone,
  };
}

const GOALS: { key: 'dailyResearchGoal' | 'dailyQualifiedGoal' | 'dailyOutreachGoal'; label: string }[] = [
  { key: 'dailyResearchGoal', label: 'Empresas pesquisadas por dia' },
  { key: 'dailyQualifiedGoal', label: 'Leads qualificados por dia' },
  { key: 'dailyOutreachGoal', label: 'Abordagens preparadas por dia' },
];

export function CampaignSettingsDialog({
  organizationId,
  campaign,
  onClose,
}: {
  organizationId: string;
  campaign: Campaign | null;
  onClose: () => void;
}) {
  const update = useUpdateCampaign(organizationId);
  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => setForm(campaign ? toForm(campaign) : null), [campaign]);

  const save = () => {
    if (!campaign || !form) return;
    const start = timeToMinutes(form.start);
    const end = timeToMinutes(form.end);
    if (end <= start) {
      toast.error('O fim do horário precisa ser depois do início.');
      return;
    }
    update.mutate(
      {
        id: campaign.id,
        patch: {
          dailyResearchGoal: form.dailyResearchGoal,
          dailyQualifiedGoal: form.dailyQualifiedGoal,
          dailyOutreachGoal: form.dailyOutreachGoal,
          workingDays: [...form.workingDays].sort(),
          workStartMinute: start,
          workEndMinute: end,
          timezone: form.timezone,
        },
      },
      {
        onSuccess: () => {
          toast.success('Campanha atualizada');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={Boolean(campaign)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{campaign?.name}</DialogTitle>
          <DialogDescription>Metas e horário valem a partir do próximo minuto, inclusive para o ciclo de hoje.</DialogDescription>
        </DialogHeader>
        {form && (
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium">Metas diárias</legend>
              {GOALS.map(({ key, label }) => (
                <label key={key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <Input
                    type="number"
                    min={0}
                    max={1000}
                    className="w-24"
                    value={form[key]}
                    onChange={(event) => setForm({ ...form, [key]: Number(event.target.value) })}
                  />
                </label>
              ))}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium">Horário de trabalho</legend>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias de trabalho">
                {WEEKDAYS.map((day) => {
                  const active = form.workingDays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setForm({
                          ...form,
                          workingDays: active
                            ? form.workingDays.filter((value) => value !== day.value)
                            : [...form.workingDays, day.value],
                        })
                      }
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs',
                        active ? 'border-accent-500 bg-accent-500/15' : 'border-border text-muted-foreground',
                      )}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Input type="time" aria-label="Início" className="w-28" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} />
                <span className="text-muted-foreground">até</span>
                <Input type="time" aria-label="Fim" className="w-28" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} />
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Fuso horário (IANA)</span>
                <Input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
              </label>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Canais</legend>
              <div className="flex items-center justify-between text-sm">
                <span>E-mail</span>
                <Switch checked disabled aria-label="E-mail habilitado" />
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>WhatsApp — integração ainda não conectada (Fase 3)</span>
                <Switch checked={false} disabled aria-label="WhatsApp indisponível" />
              </div>
            </fieldset>

            <FormError message={update.isError ? (update.error as ApiError).message : null} />
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={update.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
