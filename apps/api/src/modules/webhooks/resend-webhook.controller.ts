import { Controller, HttpCode, Post, Headers, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ResendWebhookService, type ResendWebhookHeaders } from './resend-webhook.service';
import { Public } from '../../shared/decorators/public.decorator';

// Público (sem JwtAuthGuard/TenantGuard) — quem chama é o Resend, não um
// usuário autenticado da nossa API. A verificação de autenticidade é feita
// dentro de `ResendWebhookService` (assinatura HMAC via `RESEND_WEBHOOK_SECRET`),
// não por um guard HTTP genérico.
@Public()
@Controller('webhooks/resend')
export class ResendWebhookController {
  constructor(private readonly resendWebhookService: ResendWebhookService) {}

  @HttpCode(200)
  @Post()
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: ResendWebhookHeaders,
  ): Promise<{ ok: true }> {
    // `rawBody` (Buffer) exigido pela verificação de assinatura — `app.body`
    // já vem parseado como JSON pelo ValidationPipe/body-parser globais, mas
    // a assinatura HMAC precisa dos bytes exatos recebidos, não um
    // `JSON.stringify` do objeto reconstruído (que pode não bater byte a
    // byte). `rawBody: true` habilitado em `main.ts` (`NestFactory.create`).
    await this.resendWebhookService.handleEvent(req.rawBody ?? Buffer.from(''), headers);
    return { ok: true };
  }
}
