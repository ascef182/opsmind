'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { parseReaisToCents, simulate, type SimulationResult } from '@opsmind/shared-types';
import { useCurrentMembership } from '@/lib/memberships/use-memberships';
import { useRealSimulation } from '@/lib/opsgov/use-simples';
import { OPSGOV_FINANCE_ROLES, REGIME_LABELS } from '@/lib/opsgov/types';
import { brl, fmtMonth } from '@/lib/finance/format';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/finance/finance-ui';
import { cn } from '@/lib/utils';

const pct = (value: number, digits = 3) =>
  `${value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits })}%`;
const ppmToPct = (ppm: number) => pct(ppm / 10_000);
const bpToPct = (bp: number) => pct(bp / 100, 2);

interface ScenarioInputs {
  faturamento: string;
  folha: string;
  inss: string;
}

function parseInputs(inputs: ScenarioInputs) {
  const faturamentoMensalCents = parseReaisToCents(inputs.faturamento || '0');
  const folhaMensalCents = parseReaisToCents(inputs.folha || '0');
  const inssPct = Number(inputs.inss.replace(',', '.'));
  if (faturamentoMensalCents === null || folhaMensalCents === null || !Number.isFinite(inssPct)) return null;
  return { faturamentoMensalCents, folhaMensalCents, inssSocioRateBp: Math.round(inssPct * 100) };
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'positive' | 'muted' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'tabular-nums',
          strong && 'font-semibold',
          tone === 'positive' && 'text-positive-500',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ResultBlock({ result }: { result: SimulationResult }) {
  const { anexoIII, anexoV, atual, comFatorR } = result;
  return (
    <div className="flex flex-col divide-y divide-border">
      <div className="pb-2">
        <Row label="RBT12" value={brl(result.rbt12Cents)} />
        <Row label="Fator R atual" value={`${bpToPct(result.fatorRBp)} → Anexo ${atual.anexo}`} />
      </div>
      <div className="py-2">
        <Row label="Anexo III · alíquota efetiva" value={ppmToPct(anexoIII.aliquotaEfetivaPpm)} />
        <Row label="Anexo III · DAS do mês" value={brl(anexoIII.dasCents)} />
        <Row label="Anexo V · alíquota efetiva" value={ppmToPct(anexoV.aliquotaEfetivaPpm)} />
        <Row label="Anexo V · DAS do mês" value={brl(anexoV.dasCents)} />
      </div>
      <div className="py-2">
        <Row label={`Hoje (Anexo ${atual.anexo}) · DAS + INSS`} value={brl(atual.custoTotalCents)} />
        <Row label="Pró-labore mínimo para 28%" value={brl(result.proLaboreMinimoCents)} />
        <Row
          label={`Com Fator R · DAS ${brl(comFatorR.dasCents)} + INSS ${brl(comFatorR.inssSocioCents)}`}
          value={brl(comFatorR.custoTotalCents)}
        />
      </div>
      <div className="pt-2">
        <Row
          label="Economia com Fator R"
          value={result.economiaMensalCents > 0 ? `${brl(result.economiaMensalCents)}/mês` : 'nenhuma'}
          strong
          tone={result.economiaMensalCents > 0 ? 'positive' : 'muted'}
        />
        {result.economiaMensalCents > 0 && (
          <Row label="Em 12 meses" value={brl(result.economiaMensalCents * 12)} tone="positive" />
        )}
      </div>
    </div>
  );
}

function ScenarioCard({ title, initial }: { title: string; initial: ScenarioInputs }) {
  const [inputs, setInputs] = useState(initial);
  const outcome = useMemo(() => {
    const parsed = parseInputs(inputs);
    if (!parsed) return { error: 'Preencha valores válidos.' } as const;
    try {
      return { result: simulate(parsed) } as const;
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Não foi possível simular.' } as const;
    }
  }, [inputs]);
  const set = (key: keyof ScenarioInputs) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInputs((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-h3">{title}</h2>
      <div className="grid grid-cols-[1fr_1fr_5rem] gap-3">
        <Field label="Faturamento/mês (R$)">
          <Input inputMode="decimal" value={inputs.faturamento} onChange={set('faturamento')} />
        </Field>
        <Field label="Pró-labore/mês (R$)">
          <Input inputMode="decimal" value={inputs.folha} onChange={set('folha')} />
        </Field>
        <Field label="INSS (%)">
          <Input inputMode="decimal" value={inputs.inss} onChange={set('inss')} />
        </Field>
      </div>
      {'result' in outcome && outcome.result ? (
        <ResultBlock result={outcome.result} />
      ) : (
        <p className="text-sm text-negative-500">{outcome.error}</p>
      )}
    </Card>
  );
}

function RealScenarioCard({ organizationId }: { organizationId: string }) {
  const [inputs, setInputs] = useState({ folha: '0', inss: '11' });
  const parsed = parseInputs({ faturamento: '0', ...inputs });
  const real = useRealSimulation(
    organizationId,
    { folhaMensalCents: parsed?.folhaMensalCents ?? 0, inssSocioRateBp: parsed?.inssSocioRateBp ?? 1100 },
    parsed !== null,
  );
  const set = (key: 'folha' | 'inss') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInputs((prev) => ({ ...prev, [key]: e.target.value }));
  const data = real.data;

  return (
    <Card className="flex flex-col gap-4 border-accent-500/40 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3">Cenário real</h2>
        <p className="text-xs text-muted-foreground">
          {data
            ? `RBT12 de ${fmtMonth(data.rbt12.month)} (receita da empresa, por emissão). Faturamento/mês = média dos 12 meses.`
            : 'Com o faturamento registrado no financeiro.'}
          {data?.regimeVigente && ` Regime vigente: ${REGIME_LABELS[data.regimeVigente.regime]}.`}
        </p>
      </div>
      <div className="grid grid-cols-[1fr_1fr_5rem] gap-3">
        <Field label="Faturamento/mês (R$)">
          <Input value={data?.simulation ? brl(data.simulation.faturamentoMensalCents) : '—'} disabled />
        </Field>
        <Field label="Pró-labore/mês (R$)">
          <Input inputMode="decimal" value={inputs.folha} onChange={set('folha')} />
        </Field>
        <Field label="INSS (%)">
          <Input inputMode="decimal" value={inputs.inss} onChange={set('inss')} />
        </Field>
      </div>
      {real.isLoading ? (
        <Skeleton className="h-56 w-full" />
      ) : real.isError ? (
        <p className="text-sm text-negative-500">{real.error instanceof Error ? real.error.message : 'Não foi possível simular.'}</p>
      ) : data?.simulation ? (
        <ResultBlock result={data.simulation} />
      ) : (
        <p className="text-sm text-muted-foreground">Sem receita da empresa nos últimos 12 meses.</p>
      )}
      {data?.regimeVigente?.regime === 'SIMEI' && (
        <p className="text-xs text-muted-foreground">
          No SIMEI o imposto é um valor fixo mensal; esta simulação mostra quanto seria como ME no Simples Nacional.
        </p>
      )}
    </Card>
  );
}

export default function SimuladorPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const { membership } = useCurrentMembership(organizationId);
  const seesFinance = Boolean(membership && OPSGOV_FINANCE_ROLES.includes(membership.role));

  return (
    <div className="flex flex-col gap-6">
      <div
        role="note"
        className="rounded-lg border border-accent-500/40 bg-accent-500/10 px-4 py-3 text-sm text-foreground"
      >
        <strong>Estimativa, não é parecer contábil.</strong> Considera só o DAS dos Anexos III e V (com CPP inclusa) e o INSS do
        sócio sobre o pró-labore; não inclui IRPF, FGTS, ISS fixo municipal, sublimites estaduais nem as regras de transição
        da reforma tributária. Confirme os números com o contador antes de decidir.
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <ScenarioCard title="Cenário 1" initial={{ faturamento: '5.000,00', folha: '0', inss: '11' }} />
        <ScenarioCard title="Cenário 2" initial={{ faturamento: '10.000,00', folha: '0', inss: '11' }} />
        <ScenarioCard title="Cenário 3" initial={{ faturamento: '20.000,00', folha: '0', inss: '11' }} />
        {seesFinance ? (
          <RealScenarioCard organizationId={organizationId} />
        ) : (
          <Card className="flex items-center justify-center p-5 text-sm text-muted-foreground">
            O cenário com o faturamento real fica disponível para gerentes, administradores e donos.
          </Card>
        )}
      </div>
    </div>
  );
}
