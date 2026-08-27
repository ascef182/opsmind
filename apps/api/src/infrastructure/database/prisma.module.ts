import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global: todo módulo de domínio precisa do PrismaService, e declará-lo global
 * evita reimportar PrismaModule em cada feature module (auth, organizations,
 * memberships, audit, ...).
 *
 * O Prisma Client Extension que injeta `organization_id` automaticamente nas
 * queries dos módulos com escopo de tenant (decisão de arquitetura,
 * docs/planning/sprint-1-2-plan.md §3) entra aqui quando os primeiros módulos
 * com dado escopado por organização existirem (Fase 2 em diante).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
