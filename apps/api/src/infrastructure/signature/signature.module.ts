import { Module } from '@nestjs/common';
import { SIGNATURE_SERVICE } from './signature.service';
import { ClicksignSignatureProvider } from './clicksign-signature.provider';

// Único provider por ora (Clicksign) — sem o branch por env var de
// `EmailModule` (não há um "console" equivalente sensato para assinatura
// eletrônica: sem provider real configurado, a feature simplesmente falha
// no primeiro uso, ver `ClicksignSignatureProvider`).
@Module({
  providers: [{ provide: SIGNATURE_SERVICE, useClass: ClicksignSignatureProvider }],
  exports: [SIGNATURE_SERVICE],
})
export class SignatureModule {}
