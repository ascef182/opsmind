import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { TokenService } from './token.service';

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: JwtService;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  const CONFIG: Record<string, string> = {
    JWT_ACCESS_SECRET: 'test-access-secret-with-32-plus-characters',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '30d',
  };

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        TokenService,
        {
          provide: JwtService,
          useValue: new JwtService({
            secret: CONFIG.JWT_ACCESS_SECRET,
            signOptions: { expiresIn: '15m' },
          }),
        },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: (key: string) => CONFIG[key] } },
      ],
    }).compile();

    service = module.get(TokenService);
    jwtService = module.get(JwtService);
  });

  describe('signAccessToken', () => {
    it('assina um JWT contendo apenas sub e email — nunca organizationId/role (Decisão #4)', () => {
      const token = service.signAccessToken('user-1', 'a@b.com');
      const payload = jwtService.verify(token);

      expect(payload.sub).toBe('user-1');
      expect(payload.email).toBe('a@b.com');
      expect(payload.organizationId).toBeUndefined();
      expect(payload.role).toBeUndefined();
    });
  });

  describe('issueRefreshToken', () => {
    it('persiste apenas o hash do token, nunca o valor bruto', async () => {
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const { token, expiresAt } = await service.issueRefreshToken('user-1', '127.0.0.1');

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          tokenHash: sha256(token),
          expiresAt,
          createdByIp: '127.0.0.1',
        },
      });
      expect(prisma.refreshToken.create.mock.calls[0][0].data.tokenHash).not.toBe(token);
    });

    it('define expiresAt no futuro, de acordo com JWT_REFRESH_EXPIRES_IN', async () => {
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const before = Date.now();
      const { expiresAt } = await service.issueRefreshToken('user-1');
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + thirtyDaysMs - 1000);
    });
  });

  describe('rotateRefreshToken', () => {
    it('rejeita um token que não existe', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.rotateRefreshToken('does-not-exist')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejeita um token expirado', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.rotateRefreshToken('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('detecta reuso (token já revogado) e revoga toda a família do usuário', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      });

      await expect(service.rotateRefreshToken('reused-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rotaciona um token válido: revoga o antigo e emite um novo', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });

      const result = await service.rotateRefreshToken('valid-token', '127.0.0.1');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date), replacedByTokenId: 'rt-2' },
      });
      expect(result.userId).toBe('user-1');
      expect(typeof result.token).toBe('string');
    });
  });

  describe('revokeRefreshToken', () => {
    it('marca o token como revogado quando ele existe e ainda está ativo', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ id: 'rt-1', revokedAt: null });

      await service.revokeRefreshToken('some-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('não faz nada quando o token não existe (logout idempotente)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await service.revokeRefreshToken('missing-token');

      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });
});
