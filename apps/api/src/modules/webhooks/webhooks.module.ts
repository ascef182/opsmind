import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { DealsModule } from '../deals/deals.module';
import { ResendWebhookController } from './resend-webhook.controller';
import { ResendWebhookService } from './resend-webhook.service';
import { ClicksignWebhookController } from './clicksign-webhook.controller';
import { ClicksignWebhookService } from './clicksign-webhook.service';

@Module({
  imports: [LeadsModule, DealsModule],
  controllers: [ResendWebhookController, ClicksignWebhookController],
  providers: [ResendWebhookService, ClicksignWebhookService],
})
export class WebhooksModule {}
