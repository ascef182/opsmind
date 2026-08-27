import { randomBytes, createHash } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsmind/config/env/schema';
import { PrismaService } from '../../../infrastructure/database/prisma.service';

const REFRESH_TOKEN_BYTES = 32;

/** Converte durações no formato usado pelo env schema ('30d', '15m', '1h', '45s') em ms. */
function parseDurationMs(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration);
  if (!match) {
    throw new Error(`Duração inválida: "${duration}" (formato esperado: número + s|m|h|d)`);
  }
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return value * unitMs;
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Access token: JWT de curta duração, sem `organizationId`/`role` embutidos
 * (Decisão #4 — docs/planning/reviews/code-architect-review.md).
 * Refresh token: string opaca aleatória, persistida como hash (Decisão #5),
 * com rotação a cada uso e revogação da família inteira em caso de reuso
 * detectado (checklist de segurança da Fase 1, sprint-1-2-plan.md §4).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  signAccessToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }

  async issueRefreshToken(
    userId: string,
    ip?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const { token, expiresAt } = await this.persistRefreshToken(userId, ip);
    return { token, expiresAt };
  }

  private async persistRefreshToken(
    userId: string,
    ip?: string,
  ): Promise<{ id: string; token: string; expiresAt: Date }> {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(
      Date.now() + parseDurationMs(this.configService.get('JWT_REFRESH_EXPIRES_IN', { infer: true })),
    );

    const created = await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt, createdByIp: ip },
    });

    return { id: created.id, token, expiresAt };
  }

  async rotateRefreshToken(
    rawToken: string,
    ip?: string,
  ): Promise<{ userId: string; token: string; expiresAt: Date }> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!existing) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    if (existing.revokedAt) {
      // Um token já revogado sendo reapresentado é sinal de roubo/reuso —
      // revoga toda a família ativa do usuário, não só este token.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reutilizado — sessão revogada');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expirado');
    }

    const next = await this.persistRefreshToken(existing.userId, ip);

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByTokenId: next.id },
    });

    return { userId: existing.userId, token: next.token, expiresAt: next.expiresAt };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    if (!existing || existing.revokedAt) {
      return;
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
  }
}
