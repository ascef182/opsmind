import clsx from 'clsx';

interface BudgetBarProps {
  monthSpend: number;
  monthlyBudget: number | null;
}

// 80% — mesmo espírito do aviso de contexto do Claude Code: sinaliza antes
// de bater no teto, não só depois. O estado "estourado" não é uma decisão
// nova da UI — espelha exatamente `spend >= monthlyBudget` de
// BudgetService.isOverBudget (o que de fato corta a IA no backend).
const NEAR_LIMIT_RATIO = 0.8;

export function BudgetBar({ monthSpend, monthlyBudget }: BudgetBarProps) {
  if (monthlyBudget === null) {
    return (
      <p className="text-xs text-muted-foreground">
        gasto estimado este mês: ${monthSpend.toFixed(4)} (sem orçamento configurado)
      </p>
    );
  }

  const ratio = monthlyBudget > 0 ? monthSpend / monthlyBudget : 1;
  const exceeded = monthSpend >= monthlyBudget;
  const nearLimit = !exceeded && ratio >= NEAR_LIMIT_RATIO;
  const barColor = exceeded ? 'bg-negative-500' : nearLimit ? 'bg-accent-500' : 'bg-positive-500';
  const widthPercent = Math.min(ratio, 1) * 100;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          ${monthSpend.toFixed(2)} de ${monthlyBudget.toFixed(2)} este mês
        </span>
        {exceeded && <span className="font-medium text-negative-500">orçamento atingido — IA pausada</span>}
        {nearLimit && <span className="font-medium text-accent-500">perto do limite</span>}
      </div>
      <div className="h-1.5 w-full rounded-full bg-ink-800">
        <div className={clsx('h-1.5 rounded-full transition-all', barColor)} style={{ width: `${widthPercent}%` }} />
      </div>
    </div>
  );
}
