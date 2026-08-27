import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmail: jest.Mock; findById: jest.Mock; create: jest.Mock };
  let passwordService: { hash: jest.Mock; verify: jest.Mock };
  let tokenService: {
    signAccessToken: jest.Mock;
    issueRefreshToken: jest.Mock;
    rotateRefreshToken: jest.Mock;
    revokeRefreshToken: jest.Mock;
  };
  let auditService: { log: jest.Mock };

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), findById: jest.fn(), create: jest.fn() };
    passwordService = { hash: jest.fn(), verify: jest.fn() };
    tokenService = {
      signAccessToken: jest.fn(),
      issueRefreshToken: jest.fn(),
      rotateRefreshToken: jest.fn(),
      revokeRefreshToken: jest.fn(),
    };
    auditService = { log: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: PasswordService, useValue: passwordService },
        { provide: TokenService, useValue: tokenService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register', () => {
    it('rejeita email já cadastrado sem gerar hash nem tokens', async () => {
      usersService.findByEmail.mockResolvedValue({ id: 'existing' });

      await expect(
        service.register({ email: 'a@b.com', password: 'correct horse', name: 'Ada' }),
      ).rejects.toThrow(ConflictException);
      expect(passwordService.hash).not.toHaveBeenCalled();
    });

    it('cria o usuário com senha hasheada e retorna access+refresh token', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      passwordService.hash.mockResolvedValue('hashed-password');
      usersService.create.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
      tokenService.signAccessToken.mockReturnValue('access-token');
      tokenService.issueRefreshToken.mockResolvedValue({
        token: 'refresh-token',
        expiresAt: new Date(),
      });

      const result = await service.register(
        { email: 'a@b.com', password: 'correct horse', name: 'Ada' },
        '127.0.0.1',
      );

      expect(usersService.create).toHaveBeenCalledWith({
        email: 'a@b.com',
        name: 'Ada',
        passwordHash: 'hashed-password',
      });
      expect(tokenService.signAccessToken).toHaveBeenCalledWith('user-1', 'a@b.com');
      expect(result).toEqual({ accessToken: 'access-token', refreshToken: 'refresh-token' });
    });

    it('audita o registro (marco testável do Passo 6)', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      passwordService.hash.mockResolvedValue('hashed-password');
      usersService.create.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
      tokenService.signAccessToken.mockReturnValue('access-token');
      tokenService.issueRefreshToken.mockResolvedValue({
        token: 'refresh-token',
        expiresAt: new Date(),
      });

      await service.register(
        { email: 'a@b.com', password: 'correct horse', name: 'Ada' },
        '127.0.0.1',
      );

      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        action: 'user.registered',
        resource: 'User:user-1',
        ipAddress: '127.0.0.1',
      });
    });
  });

  describe('login', () => {
    it('rejeita quando o usuário não existe (mensagem genérica, sem enumeração)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(service.login({ email: 'missing@b.com', password: 'anything' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejeita quando a senha está incorreta', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        passwordHash: 'hashed',
      });
      passwordService.verify.mockResolvedValue(false);

      await expect(service.login({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('retorna access+refresh token quando as credenciais são válidas', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        passwordHash: 'hashed',
      });
      passwordService.verify.mockResolvedValue(true);
      tokenService.signAccessToken.mockReturnValue('access-token');
      tokenService.issueRefreshToken.mockResolvedValue({
        token: 'refresh-token',
        expiresAt: new Date(),
      });

      const result = await service.login(
        { email: 'a@b.com', password: 'correct horse' },
        '127.0.0.1',
      );

      expect(result).toEqual({ accessToken: 'access-token', refreshToken: 'refresh-token' });
    });

    it('audita o login (marco testável do Passo 6)', async () => {
      usersService.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'a@b.com',
        passwordHash: 'hashed',
      });
      passwordService.verify.mockResolvedValue(true);
      tokenService.signAccessToken.mockReturnValue('access-token');
      tokenService.issueRefreshToken.mockResolvedValue({
        token: 'refresh-token',
        expiresAt: new Date(),
      });

      await service.login({ email: 'a@b.com', password: 'correct horse' }, '127.0.0.1');

      expect(auditService.log).toHaveBeenCalledWith({
        actorType: 'USER',
        actorId: 'user-1',
        action: 'user.logged_in',
        resource: 'User:user-1',
        ipAddress: '127.0.0.1',
      });
    });
  });

  describe('refresh', () => {
    it('rotaciona o refresh token e assina um novo access token para o usuário', async () => {
      tokenService.rotateRefreshToken.mockResolvedValue({
        userId: 'user-1',
        token: 'new-refresh-token',
        expiresAt: new Date(),
      });
      usersService.findById.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
      tokenService.signAccessToken.mockReturnValue('new-access-token');

      const result = await service.refresh({ refreshToken: 'old-refresh-token' });

      expect(tokenService.rotateRefreshToken).toHaveBeenCalledWith('old-refresh-token', undefined);
      expect(tokenService.signAccessToken).toHaveBeenCalledWith('user-1', 'a@b.com');
      expect(result).toEqual({ accessToken: 'new-access-token', refreshToken: 'new-refresh-token' });
    });

    it('rejeita se o usuário do token rotacionado não existir mais', async () => {
      tokenService.rotateRefreshToken.mockResolvedValue({
        userId: 'deleted-user',
        token: 'new-refresh-token',
        expiresAt: new Date(),
      });
      usersService.findById.mockResolvedValue(null);

      await expect(service.refresh({ refreshToken: 'old-refresh-token' })).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revoga o refresh token informado', async () => {
      await service.logout({ refreshToken: 'some-token' });

      expect(tokenService.revokeRefreshToken).toHaveBeenCalledWith('some-token');
    });
  });
});
