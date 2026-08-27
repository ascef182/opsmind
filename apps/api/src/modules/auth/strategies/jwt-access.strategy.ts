import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '@opsmind/config/env/schema';

interface JwtAccessPayload {
  sub: string;
  email: string;
}

/**
 * Valida o access token (payload sem organizationId/role — Decisão #4) e
 * popula `req.user`. A resolução de organização/papel é feita por request
 * pelo `TenantGuard` (Passo 8), nunca embutida aqui.
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  validate(payload: JwtAccessPayload) {
    return { id: payload.sub, email: payload.email };
  }
}
