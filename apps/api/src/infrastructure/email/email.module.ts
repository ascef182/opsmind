import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@opsmind/config/env/schema';
import { EMAIL_SERVICE, type EmailService } from './email.service';
import { ConsoleEmailProvider } from './console-email.provider';
import { ResendEmailProvider } from './resend-email.provider';

@Module({
  providers: [
    {
      provide: EMAIL_SERVICE,
      // `EMAIL_PROVIDER` já existia no schema de env (default 'console') mas
      // nunca tinha um branch de verdade — sempre caía em
      // `ConsoleEmailProvider` (plano pensando-como-empresa-com-agile-beaver.md,
      // sprint de envio real de outreach). `ResendEmailProvider` só é
      // instanciado quando `EMAIL_PROVIDER=resend`, então a checagem de
      // `RESEND_API_KEY` ausente no construtor dele age como fail-fast de
      // boot só neste modo — nunca em dev/test com o provider console.
      useFactory: (configService: ConfigService<Env, true>): EmailService => {
        const provider = configService.get('EMAIL_PROVIDER', { infer: true });
        return provider === 'resend'
          ? new ResendEmailProvider(configService)
          : new ConsoleEmailProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [EMAIL_SERVICE],
})
export class EmailModule {}
