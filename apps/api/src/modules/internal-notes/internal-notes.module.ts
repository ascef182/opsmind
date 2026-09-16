import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { InternalNotesService } from './internal-notes.service';

// Sem controller próprio — as rotas vivem em DealsController/LeadsController
// (mesmo padrão de `CustomersController.addNote`, que também não tem um
// módulo de notas dedicado). Este módulo só existe pra `InternalNotesService`
// poder ser importado tanto por `DealsModule` quanto por `LeadsModule` sem
// duplicar a declaração do provider.
@Module({
  imports: [NotificationsModule],
  providers: [InternalNotesService],
  exports: [InternalNotesService],
})
export class InternalNotesModule {}
