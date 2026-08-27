import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { PrismaModule } from './infrastructure/database/prisma.module';

@Module({
  imports: [
    // Rate limiting global (checklist de segurança da Fase 1); endpoints de
    // /auth/* recebem um throttle mais estrito quando o módulo auth é criado.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    // Módulos de domínio (users, auth, audit, organizations, memberships)
    // entram aqui incrementalmente — ver docs/planning/sprint-1-2-plan.md §4.
  ],
  controllers: [AppController],
})
export class AppModule {}
