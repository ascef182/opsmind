import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './infrastructure/database/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marco testável do Passo 2 do blueprint (docs/planning/sprint-1-2-plan.md §4):
   * a primeira prova ponta a ponta de que Docker → Prisma → Nest estão de pé
   * juntos. Checa a conexão real com o banco, não só responde 200 estático.
   */
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'connected' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
  }
}
