import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { ResendWebhookController } from './resend-webhook.controller';
import { ResendWebhookService } from './resend-webhook.service';

@Module({
  imports: [LeadsModule],
  controllers: [ResendWebhookController],
  providers: [ResendWebhookService],
})
export class WebhooksModule {}
