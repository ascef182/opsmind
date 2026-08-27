import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { validateEnv } from '@opsmind/config/env/schema';
import { AppModule } from './app.module';

async function bootstrap() {
  // Falha alto e cedo se alguma variável de ambiente obrigatória estiver
  // faltando ou mal formatada — antes de qualquer módulo do Nest subir.
  const env = validateEnv(process.env);

  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  // Validação de input em 100% dos DTOs desde o primeiro endpoint (checklist
  // de segurança da Fase 1 — docs/planning/sprint-1-2-plan.md §4).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`OpsMind API rodando em http://localhost:${env.PORT}`);
}

bootstrap();
