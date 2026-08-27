export const EMAIL_SERVICE = Symbol('EMAIL_SERVICE');

export interface SendInvitationEmailParams {
  to: string;
  organizationName: string;
  token: string;
}

/**
 * Interface de envio de email — troca de implementação isolada (Resend ou
 * similar) sem tocar nos services de domínio que a consomem. A implementação
 * de dev (`ConsoleEmailProvider`) só loga; não é bloqueante para a Fase 1
 * nem para os testes e2e (Passo 10 do blueprint).
 */
export interface EmailService {
  sendInvitationEmail(params: SendInvitationEmailParams): Promise<void>;
}
