import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from '../../shared/decorators/public.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';

// Checklist de segurança da Fase 1: rate limiting em /auth/* mais estrito que
// o default global (docs/planning/sprint-1-2-plan.md §4). `refresh`/`logout`
// entram no mesmo throttle: a posse do refresh token, não o access token, é
// o segredo que protege essas duas rotas.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Ip() ip: string) {
    return this.authService.register(dto, ip);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string) {
    return this.authService.refresh(dto, ip);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto);
  }

  // Rota protegida mínima para provar o guard/strategy ponta a ponta (marco
  // testável do Passo 5) — endpoints de perfil "de verdade" ficam para a Fase 2.
  @Get('me')
  me(@CurrentUser() user: { id: string; email: string }) {
    return user;
  }
}
