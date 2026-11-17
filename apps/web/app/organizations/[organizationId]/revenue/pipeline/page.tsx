'use client';

import { useParams } from 'next/navigation';
import { Card, FormError } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatHours, formatRate } from '@/components/revenue/revenue-ui';
import { useRevenuePipeline } from '@/lib/revenue/use-revenue';
import type { RevenuePipeline } from '@/lib/revenue/types';
import type { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

// Abaixo disso a taxa de conversão é ruído, não sinal (mesmo espírito de
// `MIN_SAMPLE_FOR_CONFIDENT_STATS` no dashboard de negócios).
const MIN_SAMPLE = 5;

export default function RevenuePipelinePage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const pipeline = useRevenuePipeline(organizationId);

  if (pipeline.isLoading) return <Skeleton className="h-96 w-full" />;
  if (pipeline.isError) return <FormError message={(pipeline.error as ApiError).message} />;
  if (!pipeline.data) return null;
  return <PipelineTable data={pipeline.data} />;
}

function PipelineTable({ data }: { data: RevenuePipeline }) {
  const max = Math.max(1, ...data.stages.map((stage) => stage.current));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Quantidade atual em cada estágio. Conversão e tempo usam as mudanças de estágio dos últimos{' '}
        {data.flowWindowDays} dias.{' '}
        {data.disqualified === 1
          ? '1 lead desqualificado fica fora do funil.'
          : `${data.disqualified.toLocaleString('pt-BR')} leads desqualificados ficam fora do funil.`}
      </p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">
                Estágio
              </th>
              <th scope="col" className="w-64 px-4 py-3 font-medium">
                Agora
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Entraram
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right font-medium"
                title="Dos que entraram no estágio, quantos chegaram depois a um estágio mais adiante"
              >
                Conversão
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Tempo mediano
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Próxima ação
              </th>
            </tr>
          </thead>
          <tbody>
            {data.stages.map((stage) => {
              const lowSample = stage.entered < MIN_SAMPLE;
              const terminal = stage.stage === 'WON' || stage.stage === 'LOST';
              return (
                <tr key={stage.stage} className="border-b border-border last:border-b-0">
                  <th scope="row" className="whitespace-nowrap px-4 py-3 text-left font-medium">
                    {stage.label}
                  </th>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="w-10 tabular-nums">{stage.current.toLocaleString('pt-BR')}</span>
                      <div className="h-2 min-w-32 flex-1 rounded-full bg-ink-800" aria-hidden>
                        <div
                          className={cn(
                            'h-2 rounded-full',
                            stage.stage === 'WON'
                              ? 'bg-positive-500'
                              : stage.stage === 'LOST'
                                ? 'bg-negative-500'
                                : 'bg-accent-500',
                          )}
                          style={{ width: `${(stage.current / max) * 100}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{stage.entered.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {terminal ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(lowSample && 'text-muted-foreground')}
                        title={lowSample ? `Amostra pequena (n=${stage.entered})` : undefined}
                      >
                        {formatRate(stage.conversionRate)}
                        {lowSample && stage.entered > 0 && <span className="ml-1 text-xs">n={stage.entered}</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatHours(stage.medianHoursInStage)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{stage.nextAction}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
