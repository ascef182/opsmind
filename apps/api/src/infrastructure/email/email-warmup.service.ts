import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsmind/config/env/schema';
import { RedisService } from '../redis/redis.service';

// Cronograma de aquecimento de domínio NOVO do Resend (resend:email-best-
// practices skill, seção "Domain Warm-up") — índice 0 = dia 1. O Resend não
// aplica esse teto por você: é responsabilidade de quem envia respeitar um
// volume crescente enquanto a reputação do domínio/IP ainda não está
// estabelecida, senão o próprio provedor de destino (Gmail/Yahoo/etc.) passa
// a marcar como spam.
const WARMUP_SCHEDULE_DAY_1_CAP = 150;
const WARMUP_SCHEDULE = [WARMUP_SCHEDULE_DAY_1_CAP, 250, 400, 700, 1000, 1500, 2000];

// 3 dias de TTL por chave diária — folga suficiente pra nunca expirar antes
// de terminar o dia em nenhum fuso, sem acumular chaves antigas pra sempre.
const KEY_TTL_SECONDS = 3 * 24 * 60 * 60;

// Mesmos limiares que o Resend recomenda monitorar durante o aquecimento.
// Só aplicados a partir de um volume mínimo de envios no dia — sem isso, 1
// bounce isolado no primeiro e-mail do dia (100% de taxa com amostra de 1)
// pausaria o envio inteiro por um ruído estatístico sem significado.
const MAX_BOUNCE_RATE = 0.04;
const MAX_COMPLAINT_RATE = 0.0008;
const MIN_SAMPLE_SIZE_FOR_RATE_CHECK = 25;

export interface EmailWarmupStatus {
  blocked: boolean;
  reason?: string;
}

/**
 * Segurança de reputação pro domínio de envio de outreach (aquecimento +
 * pausa automática por bounce/reclamação) — plano de conexão real do Resend.
 * Contador Redis por dia UTC, mesmo racional simples/síncrono de
 * `BudgetService` (corte de orçamento de IA): checa ANTES de enviar,
 * registra DEPOIS de um envio bem-sucedido (`OutreachService.send`); bounce/
 * reclamação são registrados pelo webhook inbound do Resend
 * (`ResendWebhookService`) assim que o evento chega.
 *
 * Sem `RESEND_DOMAIN_WARMUP_STARTED_AT` configurada, o teto de volume nunca
 * se aplica (domínio já aquecido, ou ambiente de dev/teste) — mas a pausa por
 * taxa de bounce/reclamação SEMPRE se aplica, independente de estar em
 * aquecimento ou não: reputação de domínio importa o tempo todo, não só nos
 * primeiros 7 dias.
 */
@Injectable()
export class EmailWarmupService {
  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async checkCanSend(): Promise<EmailWarmupStatus> {
    const sentToday = await this.getCount('sent');

    const cap = this.getTodayCap();
    if (cap !== null && sentToday >= cap) {
      return {
        blocked: true,
        reason: `Teto de aquecimento do domínio atingido hoje (${sentToday}/${cap} e-mails de outreach) — tente novamente amanhã.`,
      };
    }

    if (sentToday >= MIN_SAMPLE_SIZE_FOR_RATE_CHECK) {
      const [bounced, complained] = await Promise.all([this.getCount('bounced'), this.getCount('complained')]);
      const bounceRate = bounced / sentToday;
      const complaintRate = complained / sentToday;
      if (bounceRate > MAX_BOUNCE_RATE) {
        return {
          blocked: true,
          reason: `Taxa de bounce de hoje (${(bounceRate * 100).toFixed(1)}%) acima do limite seguro (${MAX_BOUNCE_RATE * 100}%) — envio de outreach pausado automaticamente para proteger a reputação do domínio.`,
        };
      }
      if (complaintRate > MAX_COMPLAINT_RATE) {
        return {
          blocked: true,
          reason: `Taxa de reclamação de spam de hoje (${(complaintRate * 100).toFixed(3)}%) acima do limite seguro (${MAX_COMPLAINT_RATE * 100}%) — envio de outreach pausado automaticamente para proteger a reputação do domínio.`,
        };
      }
    }

    return { blocked: false };
  }

  async recordSent(): Promise<void> {
    await this.increment('sent');
  }

  async recordBounced(): Promise<void> {
    await this.increment('bounced');
  }

  async recordComplained(): Promise<void> {
    await this.increment('complained');
  }

  // `null` = sem teto (aquecimento não configurado, ou já passou dos 7 dias
  // do cronograma — domínio considerado aquecido a partir daí).
  private getTodayCap(): number | null {
    const startedAt = this.configService.get('RESEND_DOMAIN_WARMUP_STARTED_AT', { infer: true });
    if (!startedAt) {
      return null;
    }
    const startedAtMs = Date.parse(`${startedAt}T00:00:00Z`);
    const todayMs = Date.parse(`${this.todayUtc()}T00:00:00Z`);
    const daysSinceStart = Math.floor((todayMs - startedAtMs) / (24 * 60 * 60 * 1000));
    // Antes do dia configurado como início (relógio/config inconsistentes) —
    // nunca trata isso como "sem teto"; usa o teto mais conservador (dia 1).
    if (daysSinceStart < 0) {
      return WARMUP_SCHEDULE_DAY_1_CAP;
    }
    if (daysSinceStart >= WARMUP_SCHEDULE.length) {
      return null;
    }
    return WARMUP_SCHEDULE[daysSinceStart] ?? WARMUP_SCHEDULE_DAY_1_CAP;
  }

  private async getCount(kind: 'sent' | 'bounced' | 'complained'): Promise<number> {
    const value = await this.redis.get(this.key(kind));
    return value ? Number(value) : 0;
  }

  private async increment(kind: 'sent' | 'bounced' | 'complained'): Promise<void> {
    const key = this.key(kind);
    await this.redis.incr(key);
    // NX: só define TTL na primeira escrita do dia — incrementos seguintes
    // não devem "adiar" a expiração da chave (mesmo padrão de BudgetService).
    await this.redis.expire(key, KEY_TTL_SECONDS, 'NX');
  }

  private key(kind: string): string {
    return `email-warmup:${kind}:${this.todayUtc()}`;
  }

  private todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
