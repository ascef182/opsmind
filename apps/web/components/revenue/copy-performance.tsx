'use client';

import { Card } from '@/components/ui/card';
import { FormError } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { OUTREACH_STRATEGY_LABELS, type OutreachChannel } from '@/lib/leads/types';
import { useRevenueCopyPerformance } from '@/lib/revenue/use-revenue';
import type { ApiError } from '@/lib/api-client';
import { formatRate } from './revenue-ui';

const CHANNEL_LABELS: Record<OutreachChannel, string> = {
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  WHATSAPP: 'WhatsApp',
  LINKEDIN_DM: 'LinkedIn',
  REDDIT_DM: 'Reddit',
  INSTAGRAM_DM: 'Instagram',
  OTHER: 'Outro',
};

const COLUMNS = [
  { key: 'drafts', label: 'Rascunhos' },
  { key: 'approved', label: 'Aprovados' },
  { key: 'editedBeforeApproval', label: 'Editados', title: 'Aprovados depois de o time editar o texto da IA' },
  { key: 'sent', label: 'Enviados' },
  { key: 'replied', label: 'Respostas' },
  { key: 'meetings', label: 'Reuniões' },
  { key: 'won', label: 'Vendas' },
] as const;

// Qual abordagem gera conversa comercial e receita. Ordenado por vendas e
// reuniões, não por volume de rascunhos.
export function CopyPerformanceSection({ organizationId }: { organizationId: string }) {
  const performance = useRevenueCopyPerformance(organizationId);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2">Desempenho por abordagem</h2>
        <p className="text-sm text-muted-foreground">
          Desde o início, por abordagem e canal. Respostas positivas e pedidos de demonstração entram a partir
          da {performance.data?.positiveRepliesAvailableFrom ?? 'Fase 4'}.
        </p>
      </div>
      {performance.isLoading && <Skeleton className="h-32 w-full" />}
      {performance.isError && <FormError message={(performance.error as ApiError).message} />}
      {performance.data && performance.data.rows.length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">
          Nenhum rascunho gerado com a escolha de abordagem ainda.
        </Card>
      )}
      {performance.data && performance.data.rows.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">
                  Abordagem
                </th>
                {COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="px-4 py-3 text-right font-medium"
                    title={'title' in column ? column.title : undefined}
                  >
                    {column.label}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Taxa de resposta
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Taxa de reunião
                </th>
              </tr>
            </thead>
            <tbody>
              {performance.data.rows.map((row) => (
                <tr
                  key={`${row.strategy}-${row.channel}-${row.promptVersion ?? ''}`}
                  className="border-b border-border last:border-0"
                >
                  <th scope="row" className="whitespace-nowrap px-4 py-3 text-left font-medium">
                    {OUTREACH_STRATEGY_LABELS[row.strategy] ?? row.strategy}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {CHANNEL_LABELS[row.channel] ?? row.channel}
                    </span>
                  </th>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-4 py-3 text-right tabular-nums">
                      {row[column.key].toLocaleString('pt-BR')}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums">{formatRate(row.replyRate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatRate(row.meetingRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
