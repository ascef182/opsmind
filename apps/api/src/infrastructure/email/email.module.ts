import { Module } from '@nestjs/common';
import { EMAIL_SERVICE } from './email.service';
import { ConsoleEmailProvider } from './console-email.provider';

@Module({
  providers: [{ provide: EMAIL_SERVICE, useClass: ConsoleEmailProvider }],
  exports: [EMAIL_SERVICE],
})
export class EmailModule {}
