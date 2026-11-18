'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import {
  useAddActivity,
  useChangeActivity,
  useChangeRegime,
  useChangeRegistration,
  useCompanyOverview,
  useEndActivity,
  useUpsertCompanyProfile,
} from '@/lib/opsgov/use-company';
import {
  ANEXO_LABELS,
  IBS_CBS_LABELS,
  NATUREZA_LABELS,
  OPSGOV_WRITE_ROLES,
  REGIME_LABELS,
  REVENUE_GROUP_LABELS,
  formatCnpj,
  type AnexoSimples,
  type CompanyActivity,
  type CompanyProfile,
  type IbsCbsMode,
  type NaturezaJuridica,
  type RevenueGroup,
  type TaxRegime,
} from '@/lib/opsgov/types';
import { fmtDate, todayKey } from '@/lib/finance/format';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, FormError } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, Field } from '@/components/finance/finance-ui';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

function Vigencia({ from, to }: { from: string; to: string | null }) {
  return (
    <span className="text-xs text-muted-foreground">
      {fmtDate(from)} → {to ? fmtDate(to) : <span className="text-positive-500">vigente</span>}
    </span>
  );
}

function options<T extends string>(labels: Record<T, string>) {
  return (Object.keys(labels) as T[]).map((key) => (
    <option key={key} value={key}>
      {labels[key]}
    </option>
  ));
}

function ProfileCard({ organizationId, profile, canWrite }: { organizationId: string; profile: CompanyProfile | null; canWrite: boolean }) {
  const upsert = useUpsertCompanyProfile(organizationId);
  const [form, setForm] = useState({
    razaoSocial: '',
    nomeFantasia: '',
    enderecoFiscal: '',
    municipio: '',
    uf: '',
    inscricaoMunicipal: '',
    inscricaoEstadual: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setForm({
      razaoSocial: profile.razaoSocial,
      nomeFantasia: profile.nomeFantasia ?? '',
      enderecoFiscal: profile.enderecoFiscal ?? '',
      municipio: profile.municipio ?? '',
      uf: profile.uf ?? '',
      inscricaoMunicipal: profile.inscricaoMunicipal ?? '',
      inscricaoEstadual: profile.inscricaoEstadual ?? '',
    });
  }, [profile]);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.razaoSocial.trim()) return setError('Informe a razão social.');
    const trimmed = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || undefined]));
    upsert.mutate(trimmed as never, { onError: (e) => setError(errorText(e, 'Não foi possível salvar o perfil.')) });
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-h3">Perfil da empresa</h2>
        <span className="text-xs text-muted-foreground">CNPJ atual: {formatCnpj(profile?.cnpj ?? null)}</span>
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Razão social">
          <Input value={form.razaoSocial} onChange={set('razaoSocial')} disabled={!canWrite} />
        </Field>
        <Field label="Nome fantasia">
          <Input value={form.nomeFantasia} onChange={set('nomeFantasia')} disabled={!canWrite} />
        </Field>
        <Field label="Endereço fiscal">
          <Input value={form.enderecoFiscal} onChange={set('enderecoFiscal')} disabled={!canWrite} />
        </Field>
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Field label="Município">
            <Input value={form.municipio} onChange={set('municipio')} disabled={!canWrite} />
          </Field>
          <Field label="UF">
            <Input value={form.uf} onChange={set('uf')} maxLength={2} disabled={!canWrite} />
          </Field>
        </div>
        <Field label="Inscrição municipal">
          <Input value={form.inscricaoMunicipal} onChange={set('inscricaoMunicipal')} disabled={!canWrite} />
        </Field>
        <Field label="Inscrição estadual">
          <Input value={form.inscricaoEstadual} onChange={set('inscricaoEstadual')} disabled={!canWrite} />
        </Field>
        {canWrite && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" isLoading={upsert.isPending}>
              Salvar perfil
            </Button>
            <FormError message={error} />
          </div>
        )}
      </form>
    </Card>
  );
}

type DialogKind = 'registration' | 'regime' | 'activity' | { change: CompanyActivity } | { end: CompanyActivity } | null;

function PeriodDialog({ organizationId, kind, onClose }: { organizationId: string; kind: DialogKind; onClose: () => void }) {
  const registration = useChangeRegistration(organizationId);
  const regime = useChangeRegime(organizationId);
  const addActivity = useAddActivity(organizationId);
  const changeActivity = useChangeActivity(organizationId);
  const endActivity = useEndActivity(organizationId);

  const [date, setDate] = useState(todayKey());
  const [notes, setNotes] = useState('');
  const [natureza, setNatureza] = useState<NaturezaJuridica>('MEI');
  const [cnpj, setCnpj] = useState('');
  const [taxRegime, setTaxRegime] = useState<TaxRegime>('SIMPLES_NACIONAL');
  const [ibsCbs, setIbsCbs] = useState<IbsCbsMode>('DENTRO_DAS');
  const [cnae, setCnae] = useState('');
  const [description, setDescription] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [anexo, setAnexo] = useState<AnexoSimples>('NAO_DEFINIDO');
  const [group, setGroup] = useState<RevenueGroup>('OUTROS');
  const [error, setError] = useState<string | null>(null);

  const changing = kind && typeof kind === 'object' && 'change' in kind ? kind.change : null;
  const ending = kind && typeof kind === 'object' && 'end' in kind ? kind.end : null;

  useEffect(() => {
    setError(null);
    setNotes('');
    setDate(todayKey());
    if (changing) {
      setDescription(changing.description);
      setIsPrimary(changing.isPrimary);
      setAnexo(changing.anexoSimples);
      setGroup(changing.revenueGroup);
    }
  }, [kind, changing]);

  const title =
    kind === 'registration'
      ? 'Nova vigência de cadastro'
      : kind === 'regime'
        ? 'Nova vigência de regime'
        : kind === 'activity'
          ? 'Nova atividade (CNAE)'
          : changing
            ? `Nova versão de ${changing.cnae}`
            : ending
              ? `Encerrar ${ending.cnae}`
              : '';

  const pending =
    registration.isPending || regime.isPending || addActivity.isPending || changeActivity.isPending || endActivity.isPending;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const handlers = { onSuccess: onClose, onError: (e: unknown) => setError(errorText(e, 'Não foi possível salvar.')) };
    const period = { validFrom: date, notes: notes.trim() || undefined };
    if (kind === 'registration') return registration.mutate({ ...period, naturezaJuridica: natureza, cnpj }, handlers);
    if (kind === 'regime') return regime.mutate({ ...period, regime: taxRegime, ibsCbsMode: ibsCbs }, handlers);
    if (kind === 'activity') {
      if (!description.trim()) return setError('Descreva a atividade.');
      return addActivity.mutate(
        { ...period, cnae, description: description.trim(), isPrimary, anexoSimples: anexo, revenueGroup: group },
        handlers,
      );
    }
    if (changing) {
      return changeActivity.mutate(
        { ...period, activityId: changing.id, description: description.trim(), isPrimary, anexoSimples: anexo, revenueGroup: group },
        handlers,
      );
    }
    if (ending) return endActivity.mutate({ activityId: ending.id, validTo: date }, handlers);
  }

  const activityFields = (kind === 'activity' || changing) && (
    <>
      {kind === 'activity' && (
        <Field label="CNAE" hint="Formato 0000-0/00">
          <Input value={cnae} onChange={(e) => setCnae(e.target.value)} placeholder="6201-5/01" />
        </Field>
      )}
      <Field label="Descrição">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Anexo do Simples">
          <Select value={anexo} onChange={(e) => setAnexo(e.target.value as AnexoSimples)}>
            {options(ANEXO_LABELS)}
          </Select>
        </Field>
        <Field label="Grupo de receita">
          <Select value={group} onChange={(e) => setGroup(e.target.value as RevenueGroup)}>
            {options(REVENUE_GROUP_LABELS)}
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
        Atividade principal
      </label>
    </>
  );

  return (
    <Dialog open={kind !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {ending
              ? 'A atividade deixa de valer a partir desta data. O histórico é mantido.'
              : 'O registro vigente é encerrado no dia anterior a esta data, e o novo passa a valer a partir dela. Nada é sobrescrito.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label={ending ? 'Deixa de valer em' : 'Vale a partir de'}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {kind === 'registration' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Natureza jurídica">
                <Select value={natureza} onChange={(e) => setNatureza(e.target.value as NaturezaJuridica)}>
                  {options(NATUREZA_LABELS)}
                </Select>
              </Field>
              <Field label="CNPJ">
                <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
              </Field>
            </div>
          )}
          {kind === 'regime' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Regime">
                <Select value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as TaxRegime)}>
                  {options(REGIME_LABELS)}
                </Select>
              </Field>
              <Field label="IBS/CBS">
                <Select value={ibsCbs} onChange={(e) => setIbsCbs(e.target.value as IbsCbsMode)}>
                  {options(IBS_CBS_LABELS)}
                </Select>
              </Field>
            </div>
          )}
          {activityFields}
          {!ending && (
            <Field label="Observações">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: decidido com o contador em…" />
            </Field>
          )}
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={pending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h3">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

export default function EmpresaPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const overview = useCompanyOverview(organizationId);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const canWrite = Boolean(membership && OPSGOV_WRITE_ROLES.includes(membership.role));

  if (overview.isLoading) return <Skeleton className="h-64 w-full" />;
  if (overview.isError || !overview.data) {
    return <EmptyState title="Não foi possível carregar o cadastro" description={errorText(overview.error, 'Tente novamente.')} />;
  }
  const { profile, registrationPeriods, taxRegimePeriods, activities } = overview.data;
  const addButton = (kind: DialogKind, label: string) =>
    canWrite ? (
      <Button size="sm" variant="secondary" onClick={() => setDialog(kind)}>
        {label}
      </Button>
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      <ProfileCard organizationId={organizationId} profile={profile} canWrite={canWrite} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Cadastro (natureza jurídica e CNPJ)" action={addButton('registration', 'Nova vigência')}>
          {registrationPeriods.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum cadastro registrado.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {registrationPeriods.map((p) => (
                <li key={p.id} className="flex flex-col gap-0.5 py-2">
                  <span className="text-sm">
                    {NATUREZA_LABELS[p.naturezaJuridica]} · {formatCnpj(p.cnpj)}
                  </span>
                  <Vigencia from={p.validFrom} to={p.validTo} />
                  {p.notes && <span className="text-xs text-muted-foreground">{p.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Regime tributário" action={addButton('regime', 'Nova vigência')}>
          {taxRegimePeriods.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum regime registrado.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {taxRegimePeriods.map((p) => (
                <li key={p.id} className="flex flex-col gap-0.5 py-2">
                  <span className="text-sm">
                    {REGIME_LABELS[p.regime]} · IBS/CBS: {IBS_CBS_LABELS[p.ibsCbsMode]}
                  </span>
                  <Vigencia from={p.validFrom} to={p.validTo} />
                  {p.notes && <span className="text-xs text-muted-foreground">{p.notes}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Atividades (CNAEs)" action={addButton('activity', 'Adicionar CNAE')}>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma atividade registrada.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {activities.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm">
                    <span className="font-mono">{a.cnae}</span> · {a.description}
                    {a.isPrimary && <span className="ml-2 rounded bg-accent-500/15 px-1.5 text-xs text-accent-500">principal</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ANEXO_LABELS[a.anexoSimples]} · {REVENUE_GROUP_LABELS[a.revenueGroup]}
                  </span>
                  <Vigencia from={a.validFrom} to={a.validTo} />
                </div>
                {canWrite && a.validTo === null && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ change: a })}>
                      Nova versão
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ end: a })}>
                      Encerrar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <PeriodDialog organizationId={organizationId} kind={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
