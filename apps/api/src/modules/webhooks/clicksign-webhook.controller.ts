import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ClicksignWebhookService } from './clicksign-webhook.service';
import { Public } from '../../shared/decorators/public.decorator';

// Público (sem JwtAuthGuard/TenantGuard) — quem chama é a Clicksign, não um
// usuário autenticado da nossa API. Verificação de autenticidade por chave
// de conta dentro de `ClicksignWebhookService` (ver comentário lá — a
// Clicksign não documenta assinatura HMAC de payload como o Resend).
@Public()
@Controller('webhooks/clicksign')
export class ClicksignWebhookController {
  constructor(private readonly clicksignWebhookService: ClicksignWebhookService) {}

  // A Clicksign exige resposta HTTP 200 (não só 2xx) — "qualquer resposta
  // fora do intervalo 2XX informará que você não recebeu seu webhook"
  // (melhores práticas de webhook, developers.clicksign.com).
  @HttpCode(200)
  @Post()
  async handle(@Body() body: unknown): Promise<{ ok: true }> {
    await this.clicksignWebhookService.handleEvent(body as never);
    return { ok: true };
  }
}
