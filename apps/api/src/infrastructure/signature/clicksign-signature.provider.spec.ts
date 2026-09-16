import { ServiceUnavailableException } from '@nestjs/common';
import { ClicksignSignatureProvider } from './clicksign-signature.provider';

function buildConfigService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    CLICKSIGN_API_TOKEN: 'token-123',
    CLICKSIGN_BASE_URL: 'https://sandbox.clicksign.com',
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('ClicksignSignatureProvider', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  describe('createSignatureRequest', () => {
    it('cria envelope, sobe documento, cadastra signatário, vincula e ativa — nesta ordem', async () => {
      const provider = new ClicksignSignatureProvider(buildConfigService() as never);
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'env-1' } }, 201)) // createEnvelope
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'doc-1' } }, 201)) // uploadDocument
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'signer-1' } }, 201)) // createSigner
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'req-1' } }, 201)) // createRequirement
        .mockResolvedValueOnce(jsonResponse({ data: { id: 'env-1' } }, 200)); // activateEnvelope

      const result = await provider.createSignatureRequest({
        envelopeName: 'Proposta — Acme',
        documentFilename: 'proposta.pdf',
        documentBase64: 'ZmFrZS1wZGY=',
        signerName: 'João Silva',
        signerEmail: 'joao@acme.com',
      });

      expect(result).toEqual({ externalEnvelopeId: 'env-1', externalDocumentId: 'doc-1' });
      expect(fetchMock).toHaveBeenCalledTimes(5);

      const [envelopeCall, documentCall, signerCall, requirementCall, activateCall] = fetchMock.mock.calls;

      expect(envelopeCall[0]).toBe('https://sandbox.clicksign.com/api/v3/envelopes');
      expect(envelopeCall[1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ Authorization: 'token-123' }) });
      expect(JSON.parse(envelopeCall[1].body)).toMatchObject({
        data: { type: 'envelopes', attributes: { name: 'Proposta — Acme' } },
      });

      expect(documentCall[0]).toBe('https://sandbox.clicksign.com/api/v3/envelopes/env-1/documents');
      expect(JSON.parse(documentCall[1].body)).toMatchObject({
        data: { type: 'documents', attributes: { filename: 'proposta.pdf', content_base64: 'ZmFrZS1wZGY=' } },
      });

      expect(signerCall[0]).toBe('https://sandbox.clicksign.com/api/v3/envelopes/env-1/signers');
      expect(JSON.parse(signerCall[1].body)).toMatchObject({
        data: { type: 'signers', attributes: { name: 'João Silva', email: 'joao@acme.com' } },
      });

      expect(requirementCall[0]).toBe('https://sandbox.clicksign.com/api/v3/envelopes/env-1/requirements');
      expect(JSON.parse(requirementCall[1].body)).toMatchObject({
        data: {
          type: 'requirements',
          attributes: { action: 'agree', role: 'sign' },
          relationships: {
            document: { data: { type: 'documents', id: 'doc-1' } },
            signer: { data: { type: 'signers', id: 'signer-1' } },
          },
        },
      });

      expect(activateCall[0]).toBe('https://sandbox.clicksign.com/api/v3/envelopes/env-1');
      expect(activateCall[1]).toMatchObject({ method: 'PATCH' });
      expect(JSON.parse(activateCall[1].body)).toMatchObject({
        data: { id: 'env-1', type: 'envelopes', attributes: { status: 'running' } },
      });
    });

    it('lança ServiceUnavailableException quando CLICKSIGN_API_TOKEN não está configurado', async () => {
      const provider = new ClicksignSignatureProvider(buildConfigService({ CLICKSIGN_API_TOKEN: undefined }) as never);

      await expect(
        provider.createSignatureRequest({
          envelopeName: 'x',
          documentFilename: 'x.pdf',
          documentBase64: 'x',
          signerName: 'x',
          signerEmail: 'x@x.com',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('lança ServiceUnavailableException quando a Clicksign responde com erro', async () => {
      const provider = new ClicksignSignatureProvider(buildConfigService() as never);
      fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ detail: 'invalid name' }] }, 422));

      await expect(
        provider.createSignatureRequest({
          envelopeName: '',
          documentFilename: 'x.pdf',
          documentBase64: 'x',
          signerName: 'x',
          signerEmail: 'x@x.com',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('getStatus', () => {
    it('retorna o status cru e a URL do documento assinado quando incluída na resposta', async () => {
      const provider = new ClicksignSignatureProvider(buildConfigService() as never);
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: { id: 'env-1', attributes: { status: 'closed' } },
          included: [{ type: 'documents', attributes: { signed_file_url: 'https://sandbox.clicksign.com/f/abc' } }],
        }),
      );

      const result = await provider.getStatus('env-1');

      expect(result).toEqual({ status: 'closed', documentUrl: 'https://sandbox.clicksign.com/f/abc' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://sandbox.clicksign.com/api/v3/envelopes/env-1?include=documents',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('documentUrl null quando o envelope ainda não fechou (sem documento assinado incluído)', async () => {
      const provider = new ClicksignSignatureProvider(buildConfigService() as never);
      fetchMock.mockResolvedValueOnce(jsonResponse({ data: { id: 'env-1', attributes: { status: 'running' } } }));

      const result = await provider.getStatus('env-1');

      expect(result).toEqual({ status: 'running', documentUrl: null });
    });
  });
});
