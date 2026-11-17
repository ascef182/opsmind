import { BadRequestException } from '@nestjs/common';
import { ResendWebhookService } from './resend-webhook.service';

const verifyMock = jest.fn();
const receivingGetMock = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    webhooks: { verify: verifyMock },
    emails: { receiving: { get: receivingGetMock } },
  })),
}));

function configService(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    RESEND_API_KEY: 're_test_key',
    RESEND_WEBHOOK_SECRET: 'whsec_test',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as never;
}

function buildDeps(overrides: Record<string, string | undefined> = {}) {
  const prisma = {
    outreachMessage: { findFirst: jest.fn() },
    lead: { findFirst: jest.fn().mockResolvedValue({ name: 'Lead', campaignId: null }) },
  };
  const outreachService = { markRepliedFromWebhook: jest.fn().mockResolvedValue(undefined) };
  const emailWarmupService = {
    recordBounced: jest.fn().mockResolvedValue(undefined),
    recordComplained: jest.fn().mockResolvedValue(undefined),
  };
  const recorder = { event: jest.fn().mockResolvedValue(undefined) };
  const service = new ResendWebhookService(
    configService(overrides),
    prisma as never,
    outreachService as never,
    emailWarmupService as never,
    recorder as never,
  );
  return { service, prisma, outreachService, emailWarmupService, recorder };
}

const rawBody = Buffer.from('{"type":"email.received"}');
const headers = { 'svix-id': 'id-1', 'svix-timestamp': '123', 'svix-signature': 'sig' };

describe('ResendWebhookService', () => {
  beforeEach(() => {
    verifyMock.mockReset();
    receivingGetMock.mockReset();
  });

  it('ignora silenciosamente quando RESEND_WEBHOOK_SECRET não está configurado (fail-closed)', async () => {
    const { service } = buildDeps({ RESEND_WEBHOOK_SECRET: undefined });

    await service.handleEvent(rawBody, headers);

    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('ignora silenciosamente quando RESEND_API_KEY não está configurado', async () => {
    const { service } = buildDeps({ RESEND_API_KEY: undefined });

    await service.handleEvent(rawBody, headers);

    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('lança BadRequestException quando a assinatura é inválida', async () => {
    const { service } = buildDeps();
    verifyMock.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    await expect(service.handleEvent(rawBody, headers)).rejects.toThrow(BadRequestException);
  });

  it('ignora eventos que não são email.received/bounced/complained', async () => {
    const { service } = buildDeps();
    verifyMock.mockReturnValue({ type: 'email.sent', data: {} });

    await service.handleEvent(rawBody, headers);

    expect(receivingGetMock).not.toHaveBeenCalled();
  });

  it('email.bounced: registra no EmailWarmupService e não toca em OutreachMessage', async () => {
    const { service, prisma, emailWarmupService } = buildDeps();
    verifyMock.mockReturnValue({ type: 'email.bounced', data: { email_id: 'email-1' } });

    await service.handleEvent(rawBody, headers);

    expect(emailWarmupService.recordBounced).toHaveBeenCalledTimes(1);
    expect(emailWarmupService.recordComplained).not.toHaveBeenCalled();
    expect(receivingGetMock).not.toHaveBeenCalled();
    expect(prisma.outreachMessage.findFirst).not.toHaveBeenCalled();
  });

  it('email.complained: registra no EmailWarmupService e não toca em OutreachMessage', async () => {
    const { service, prisma, emailWarmupService } = buildDeps();
    verifyMock.mockReturnValue({ type: 'email.complained', data: { email_id: 'email-1' } });

    await service.handleEvent(rawBody, headers);

    expect(emailWarmupService.recordComplained).toHaveBeenCalledTimes(1);
    expect(emailWarmupService.recordBounced).not.toHaveBeenCalled();
    expect(receivingGetMock).not.toHaveBeenCalled();
    expect(prisma.outreachMessage.findFirst).not.toHaveBeenCalled();
  });

  it('busca o email completo e ignora quando não há In-Reply-To', async () => {
    const { service, prisma } = buildDeps();
    verifyMock.mockReturnValue({ type: 'email.received', data: { email_id: 'email-1' } });
    receivingGetMock.mockResolvedValue({ data: { headers: {} }, error: null });

    await service.handleEvent(rawBody, headers);

    expect(prisma.outreachMessage.findFirst).not.toHaveBeenCalled();
  });

  it('ignora quando nenhum OutreachMessage corresponde ao providerMessageId', async () => {
    const { service, prisma, outreachService } = buildDeps();
    verifyMock.mockReturnValue({ type: 'email.received', data: { email_id: 'email-1' } });
    receivingGetMock.mockResolvedValue({
      data: { headers: { 'in-reply-to': '<original-msg-id@resend.dev>' } },
      error: null,
    });
    prisma.outreachMessage.findFirst.mockResolvedValue(null);

    await service.handleEvent(rawBody, headers);

    expect(prisma.outreachMessage.findFirst).toHaveBeenCalledWith({
      where: { providerMessageId: 'original-msg-id@resend.dev' },
    });
    expect(outreachService.markRepliedFromWebhook).not.toHaveBeenCalled();
  });

  it('encontra o OutreachMessage pelo providerMessageId e marca como respondida (com organizationId correto, nunca adivinhado)', async () => {
    const { service, prisma, outreachService } = buildDeps();
    verifyMock.mockReturnValue({ type: 'email.received', data: { email_id: 'email-1' } });
    receivingGetMock.mockResolvedValue({
      data: { headers: { 'in-reply-to': '<original-msg-id@resend.dev>' } },
      error: null,
    });
    prisma.outreachMessage.findFirst.mockResolvedValue({
      id: 'msg-1',
      organizationId: 'org-1',
      providerMessageId: 'original-msg-id@resend.dev',
    });

    await service.handleEvent(rawBody, headers);

    expect(outreachService.markRepliedFromWebhook).toHaveBeenCalledWith('org-1', 'msg-1');
  });

  it('engole o erro quando markRepliedFromWebhook falha (idempotência — mensagem já respondida/estado inesperado)', async () => {
    const { service, prisma, outreachService } = buildDeps();
    verifyMock.mockReturnValue({ type: 'email.received', data: { email_id: 'email-1' } });
    receivingGetMock.mockResolvedValue({
      data: { headers: { 'in-reply-to': '<original-msg-id@resend.dev>' } },
      error: null,
    });
    prisma.outreachMessage.findFirst.mockResolvedValue({
      id: 'msg-1',
      organizationId: 'org-1',
      providerMessageId: 'original-msg-id@resend.dev',
    });
    outreachService.markRepliedFromWebhook.mockRejectedValue(new Error('já respondida'));

    await expect(service.handleEvent(rawBody, headers)).resolves.toBeUndefined();
  });
});
