import { ClicksignWebhookService } from './clicksign-webhook.service';

function buildDeps(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { CLICKSIGN_ACCOUNT_KEY: 'account-key-1', ...overrides };
  const configService = { get: jest.fn((key: string) => values[key]) };
  const dealSignatureService = { syncStatusFromProvider: jest.fn().mockResolvedValue(null) };

  const service = new ClicksignWebhookService(configService as never, dealSignatureService as never);

  return { service, configService, dealSignatureService };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event: { name: 'close', data: { account: { key: 'account-key-1' } } },
    document: { key: 'env-1' },
    ...overrides,
  };
}

describe('ClicksignWebhookService', () => {
  it('confirma o status via syncStatusFromProvider quando a conta do payload confere', async () => {
    const { service, dealSignatureService } = buildDeps();

    await service.handleEvent(payload());

    expect(dealSignatureService.syncStatusFromProvider).toHaveBeenCalledWith('env-1');
  });

  it('ignora o evento quando CLICKSIGN_ACCOUNT_KEY não está configurado (fail-closed)', async () => {
    const { service, dealSignatureService } = buildDeps({ CLICKSIGN_ACCOUNT_KEY: undefined });

    await service.handleEvent(payload());

    expect(dealSignatureService.syncStatusFromProvider).not.toHaveBeenCalled();
  });

  it('ignora o evento quando a chave de conta do payload não confere (defesa contra forjar evento)', async () => {
    const { service, dealSignatureService } = buildDeps();

    await service.handleEvent(payload({ event: { name: 'close', data: { account: { key: 'conta-de-outro' } } } }));

    expect(dealSignatureService.syncStatusFromProvider).not.toHaveBeenCalled();
  });

  it('ignora silenciosamente quando não consegue identificar o envelope no payload', async () => {
    const { service, dealSignatureService } = buildDeps();

    await service.handleEvent(payload({ document: {} }));

    expect(dealSignatureService.syncStatusFromProvider).not.toHaveBeenCalled();
  });

  it('não propaga erro quando syncStatusFromProvider falha (idempotência/retry do Resend não deve derrubar o endpoint)', async () => {
    const { service, dealSignatureService } = buildDeps();
    dealSignatureService.syncStatusFromProvider.mockRejectedValue(new Error('timeout'));

    await expect(service.handleEvent(payload())).resolves.toBeUndefined();
  });
});
