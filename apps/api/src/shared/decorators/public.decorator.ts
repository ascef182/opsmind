import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca uma rota como pública, para que o `JwtAuthGuard` global (Passo 5)
 * não exija access token — ex.: `POST /auth/register`, `POST /auth/login`.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
