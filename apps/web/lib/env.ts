import { z } from 'zod';

/**
 * Variáveis públicas do Next.js (`NEXT_PUBLIC_*`) são inlinadas em build
 * time, não lidas em runtime — então diferente do fail-fast do apps/api
 * (validateEnv no bootstrap), aqui só dá pra validar com um fallback
 * razoável para dev local, não travar o build.
 */
const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
});

export const env = envSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
