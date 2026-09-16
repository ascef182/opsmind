import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsmind/config/env/schema';
import { DealSignatureService } from '../deals/deal-signature.service';

interface ClicksignWebhookPayload {
  event?: { name?: string; data?: { account?: { key?: string } } };
  // A Clicksign não documenta publicamente a chave exata pra identificar o
  // envelope dentro de `document` (verificado nesta sessão, ver comentário
  // em `extractEnvelopeKey`) — tipo solto de propósito.
  document?: unknown;
}

/**
 * Fecha o loop da assinatura eletrônica (trilha de fechamento, plano
 * pensando-como-empresa-com-agile-beaver.md): recebe o webhook da Clicksign
 * (evento `close`/`document_closed`) e dispara
 * `DealSignatureService.syncStatusFromProvider`, que NUNCA confia no
 * `status` do payload — sempre confirma via uma chamada autenticada de
 * volta à API da Clicksign antes de gravar qualquer mudança.
 *
 * Fail-closed por chave de conta, não por assinatura HMAC: a documentação
 * pública da Clicksign (developers.clicksign.com, verificado nesta sessão)
 * não descreve um esquema de assinatura de payload de webhook como o do
 * Resend (`resend.webhooks.verify`) — só confirma que o campo
 * `event.data.account.key` identifica a conta de origem. Comparar contra
 * `CLICKSIGN_ACCOUNT_KEY` configurado é a defesa disponível; combinado com
 * `syncStatusFromProvider` sempre re-confirmar o status via API (nunca só
 * pelo payload), isso é defesa em profundidade suficiente até a Clicksign
 * documentar (ou eu confirmar contra uma conta sandbox real) um mecanismo
 * de assinatura mais forte.
 */
@Injectable()
export class ClicksignWebhookService {
  private readonly logger = new Logger(ClicksignWebhookService.name);

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly dealSignatureService: DealSignatureService,
  ) {}

  async handleEvent(payload: ClicksignWebhookPayload): Promise<void> {
    const accountKey = this.configService.get('CLICKSIGN_ACCOUNT_KEY', { infer: true });
    if (!accountKey) {
      this.logger.warn('Webhook da Clicksign recebido, mas CLICKSIGN_ACCOUNT_KEY não configurado — ignorando.');
      return;
    }

    const payloadAccountKey = payload.event?.data?.account?.key;
    if (payloadAccountKey !== accountKey) {
      this.logger.warn('Webhook da Clicksign recebido com chave de conta que não confere — ignorando.');
      return;
    }

    const envelopeKey = extractEnvelopeKey(payload.document);
    if (!envelopeKey) {
      this.logger.warn('Webhook da Clicksign recebido, mas não foi possível identificar o envelope — ignorando.');
      return;
    }

    try {
      await this.dealSignatureService.syncStatusFromProvider(envelopeKey);
    } catch (err) {
      // Idempotência: a Clicksign reenvia webhooks não confirmados com 2xx
      // (ver "melhores práticas" da documentação) — nunca derruba o
      // endpoint por uma falha transitória na chamada de confirmação.
      this.logger.debug(
        `syncStatusFromProvider falhou para envelope ${envelopeKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// NÃO CONFIRMADO contra uma execução real (sem conta sandbox nesta sessão)
// — a documentação pública mostra o campo `document` no payload do webhook
// mas não detalha exatamente onde mora o id do envelope dentro dele.
// Tentativa nesta ordem: `document.key` (convenção comum de "chave" na
// Clicksign v1/v2) e `document.envelope.key` (caminho aninhado plausível na
// v3, cujos outros recursos usam `relationships`). Verificar contra uma
// conta sandbox real (sandbox.clicksign.com/signup) antes de produção — se
// nenhum dos dois bater, ajustar aqui.
function extractEnvelopeKey(document: unknown): string | null {
  if (!document || typeof document !== 'object') {
    return null;
  }
  const doc = document as { key?: unknown; envelope?: { key?: unknown } };
  if (typeof doc.key === 'string' && doc.key.length > 0) {
    return doc.key;
  }
  if (typeof doc.envelope?.key === 'string' && doc.envelope.key.length > 0) {
    return doc.envelope.key;
  }
  return null;
}
