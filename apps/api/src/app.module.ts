import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from '@opsmind/config/env/schema';
import { AppController } from './app.controller';
import { PrismaModule } from './infrastructure/database/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AiModule } from './modules/ai/ai.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { JwtAuthGuard } from './shared/guards/jwt-auth.guard';
import { TenantContextInterceptor } from './shared/interceptors/tenant-context.interceptor';

@Module({
  imports: [
    // `validate` reaproveita o mesmo schema Zod já usado no fail-fast do
    // main.ts, expondo os valores validados via ConfigService para os módulos
    // que precisam deles em injeção de dependência (ex.: AuthModule/JwtModule).
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Rate limiting global (checklist de segurança da Fase 1); /auth/* recebe
    // um throttle mais estrito via @Throttle() no próprio controller.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    RedisModule,
    AuditModule,
    UsersModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    CustomersModule,
    TasksModule,
    NotificationsModule,
    DashboardModule,
    AiModule,
    AutomationsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global: toda rota exige access token válido, exceto as marcadas @Public()
    // (register/login/refresh/logout, health check).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Roda depois dos guards (JwtAuthGuard populou req.user; TenantGuard, nas
    // rotas que o usam, populou req.membership) — abre a transação de request
    // que faz o RLS do Postgres valer (docs/planning/reviews/
    // database-reviewer-review.md §1.3).
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
