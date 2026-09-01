import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { validateEnv, type Env } from '@opsmind/config/env/schema';
import { buildLoggerOptions } from './infrastructure/logging/logger-options';
import { AppController } from './app.controller';
import { PrismaModule } from './infrastructure/database/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DocumentsModule } from './modules/documents/documents.module';
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
    // Sentry captura exceptions (via SentryGlobalFilter abaixo) — precisa vir
    // cedo na lista de imports, antes dos módulos de domínio.
    SentryModule.forRoot(),
    // Logging estruturado (PRD §15) — nível e formato via buildLoggerOptions
    // (JSON puro em produção, pino-pretty em dev). `forRootAsync` porque a
    // configuração depende de ConfigService (env validado), não de literais.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => ({
        pinoHttp: buildLoggerOptions({
          NODE_ENV: configService.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: configService.get('LOG_LEVEL', { infer: true }),
        }),
      }),
    }),
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
    StorageModule,
    AuditModule,
    UsersModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    CustomersModule,
    TasksModule,
    NotificationsModule,
    DashboardModule,
    DocumentsModule,
    AiModule,
    AutomationsModule,
  ],
  controllers: [AppController],
  providers: [
    // Sem exception filter global próprio ainda — SentryGlobalFilter reporta
    // todo erro não tratado ao Sentry (quando SENTRY_DSN está configurado) e
    // preserva o comportamento padrão de resposta HTTP do Nest pros demais
    // casos. Precisa ser registrado ANTES de qualquer outro APP_FILTER.
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
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
