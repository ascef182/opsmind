import {
  OUTREACH_STRATEGY_LABELS,
  QUALITY_CRITERION_LABELS,
  type OutreachMessage,
  type QualityCriterion,
} from '@/lib/leads/types';

const PHONE_SCRIPT_LABELS = ['Abertura:', 'Pergunta de descoberta:', 'Próximo passo:'];

function scoreTone(score: number): string {
  if (score >= 8) return 'text-positive-500';
  if (score >= 6) return 'text-accent-400';
  return 'text-negative-500';
}

// Abordagem escolhida pela pesquisa + revisão de qualidade feita antes de
// salvar. O revisor humano vê por que a mensagem diz o que diz.
export function DraftQuality({ message }: { message: OutreachMessage }) {
  const review = message.qualityReview;
  if (!message.strategy && !review) return null;

  return (
    <details className="mt-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-muted-foreground">
        {message.strategy && (
          <span className="rounded-full border border-border px-2 py-0.5 font-medium text-foreground">
            {OUTREACH_STRATEGY_LABELS[message.strategy]}
          </span>
        )}
        {review?.status === 'REVIEWED' && (
          <span className={`font-medium ${scoreTone(review.average)}`}>
            Qualidade {review.average.toFixed(1)}/10
          </span>
        )}
        {review?.status === 'UNREVIEWED' && (
          <span className="font-medium text-accent-400">Não revisado pela IA: confira com atenção</span>
        )}
        {review && review.attempts > 1 && <span>{review.attempts} versões geradas</span>}
      </summary>

      <div className="mt-2 flex flex-col gap-2">
        {review && review.strategyReasons.length > 0 && (
          <p>
            <span className="text-muted-foreground">Por que esta abordagem: </span>
            {review.strategyReasons.join('; ')}
          </p>
        )}
        {review?.status === 'REVIEWED' && (
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {(Object.keys(QUALITY_CRITERION_LABELS) as QualityCriterion[]).map((criterion) => (
              <li key={criterion} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{QUALITY_CRITERION_LABELS[criterion]}</span>
                <span className={`font-medium tabular-nums ${scoreTone(review.scores[criterion])}`}>
                  {review.scores[criterion]}
                </span>
              </li>
            ))}
          </ul>
        )}
        {review?.status === 'REVIEWED' && review.issues.length > 0 && (
          <div>
            <p className="text-muted-foreground">Observações do revisor:</p>
            <ul className="list-disc pl-4">
              {review.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        {review && review.deterministicIssues.length > 0 && (
          <div>
            <p className="text-muted-foreground">Regras não atendidas:</p>
            <ul className="list-disc pl-4">
              {review.deterministicIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        {review?.status === 'UNREVIEWED' && <p className="text-muted-foreground">Motivo: {review.reason}</p>}
      </div>
    </details>
  );
}

// Roteiro de ligação vem em três blocos rotulados; o resto é texto corrido.
export function OutreachBody({ message }: { message: OutreachMessage }) {
  if (message.channel !== 'PHONE' || !PHONE_SCRIPT_LABELS.some((label) => message.body.includes(label))) {
    return <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/80">{message.body}</p>;
  }
  const blocks = message.body
    .split(/\n(?=Abertura:|Pergunta de descoberta:|Próximo passo:)/)
    .map((block) => block.trim())
    .filter(Boolean);
  return (
    <dl className="mt-2 flex flex-col gap-2 text-sm">
      {blocks.map((block) => {
        const label = PHONE_SCRIPT_LABELS.find((candidate) => block.startsWith(candidate));
        return (
          <div key={block}>
            {label && <dt className="text-xs font-medium text-muted-foreground">{label.slice(0, -1)}</dt>}
            <dd className="whitespace-pre-wrap text-foreground/80">{label ? block.slice(label.length).trim() : block}</dd>
          </div>
        );
      })}
    </dl>
  );
}
