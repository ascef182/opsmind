import { Global, Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { HarveyActivityRecorder } from './harvey-activity.recorder';
import { HarveyEventsPublisher } from './harvey-events.publisher';

// Global: leads, outreach, webhooks e organizations registram atividades do
// Harvey ou resolvem a campanha padrão sem importar o módulo de controle.
@Global()
@Module({
  providers: [CampaignsService, HarveyEventsPublisher, HarveyActivityRecorder],
  exports: [CampaignsService, HarveyEventsPublisher, HarveyActivityRecorder],
})
export class HarveyCoreModule {}
