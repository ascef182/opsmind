import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  async register(dto: RegisterDto, ip?: string): Promise<AuthResult> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email já cadastrado');
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.usersService.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
    });

    await this.auditService.log({
      actorType: 'USER',
      actorId: user.id,
      action: 'user.registered',
      resource: `User:${user.id}`,
      ipAddress: ip,
    });

    return this.issueTokens(user.id, user.email, ip);
  }

  async login(dto: LoginDto, ip?: string): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);
    // Mensagem genérica em ambos os casos (usuário inexistente ou senha
    // errada) para não permitir enumeração de emails cadastrados.
    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const passwordValid = await this.passwordService.verify(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    await this.auditService.log({
      actorType: 'USER',
      actorId: user.id,
      action: 'user.logged_in',
      resource: `User:${user.id}`,
      ipAddress: ip,
    });

    return this.issueTokens(user.id, user.email, ip);
  }

  async refresh(dto: RefreshTokenDto, ip?: string): Promise<AuthResult> {
    const rotated = await this.tokenService.rotateRefreshToken(dto.refreshToken, ip);

    const user = await this.usersService.findById(rotated.userId);
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return {
      accessToken: this.tokenService.signAccessToken(user.id, user.email),
      refreshToken: rotated.token,
    };
  }

  async logout(dto: RefreshTokenDto): Promise<void> {
    await this.tokenService.revokeRefreshToken(dto.refreshToken);
  }

  private async issueTokens(userId: string, email: string, ip?: string): Promise<AuthResult> {
    const accessToken = this.tokenService.signAccessToken(userId, email);
    const { token: refreshToken } = await this.tokenService.issueRefreshToken(userId, ip);
    return { accessToken, refreshToken };
  }
}
