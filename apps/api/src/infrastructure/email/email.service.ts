export const EMAIL_SERVICE = Symbol('EMAIL_SERVICE');

export interface SendInvitationEmailParams {
  to: string;
  organizationName: string;
  token: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  // Formato `<event-type>/<entity-id>` (resend:resend skill) — evita reenvio
  // duplicado quando uma chamada é repetida (retry de rede, dois cliques).
  // Opcional porque `ConsoleEmailProvider` não tem noção de idempotência.
  idempotencyKey?: string;
}

export interface SendEmailResult {
  // Id do provider (ex.: id do Resend) — `null` em `ConsoleEmailProvider`
  // (não envia de verdade, não existe id nenhum). `OutreachService.send`
  // grava em `OutreachMessage.providerMessageId` para correlacionar uma
  // resposta recebida via webhook inbound de volta a esta mensagem.
  id: string | null;
}

/**
 * Interface de envio de email — troca de implementação isolada (Resend ou
 * similar) sem tocar nos services de domínio que a consomem. A implementação
 * de dev (`ConsoleEmailProvider`) só loga; não é bloqueante para a Fase 1
 * nem para os testes e2e (Passo 10 do blueprint).
 *
 * `sendEmail` (genérico) foi adicionado no plano
 * pensando-como-empresa-com-agile-beaver.md para o envio real de
 * `OutreachMessage` (`OutreachService.send`) — reaproveita a mesma
 * abstração/implementação que já existia só para convites, em vez de criar
 * um segundo mecanismo de envio paralelo.
 */
export interface EmailService {
  // Identificação e custo estimado por mensagem, para a razão de custos
  // (`CostEvent`) do Revenue Engine.
  readonly providerName: string;
  readonly costPerMessageUsd: number;
  sendInvitationEmail(params: SendInvitationEmailParams): Promise<void>;
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;
}
