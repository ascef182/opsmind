import { ResendEmailProvider } from './resend-email.provider';

const sendMock = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

function configService(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'OpsMind <onboarding@resend.dev>',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as never;
}

describe('ResendEmailProvider', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('lança na construção quando RESEND_API_KEY está ausente', () => {
    expect(() => new ResendEmailProvider(configService({ RESEND_API_KEY: '' }))).toThrow();
  });

  describe('sendEmail', () => {
    it('envia via Resend com from/to/subject/html e idempotencyKey quando informado, retornando o id', async () => {
      sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
      const provider = new ResendEmailProvider(configService());

      const result = await provider.sendEmail({
        to: 'lead@example.com',
        subject: 'Assunto X',
        html: '<p>Corpo</p>',
        idempotencyKey: 'outreach-message/msg-1',
      });

      expect(result).toEqual({ id: 'email-1' });
      expect(sendMock).toHaveBeenCalledWith(
        {
          from: 'OpsMind <onboarding@resend.dev>',
          to: ['lead@example.com'],
          subject: 'Assunto X',
          html: '<p>Corpo</p>',
        },
        { idempotencyKey: 'outreach-message/msg-1' },
      );
    });

    it('não usa try/catch para erro da API — checa error explicitamente e lança ServiceUnavailableException', async () => {
      sendMock.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });
      const provider = new ResendEmailProvider(configService());

      await expect(
        provider.sendEmail({ to: 'lead@example.com', subject: 'X', html: '<p>Y</p>' }),
      ).rejects.toThrow('domain not verified');
    });
  });

  describe('sendInvitationEmail', () => {
    it('envia o convite com organização e token no corpo', async () => {
      sendMock.mockResolvedValue({ data: { id: 'email-2' }, error: null });
      const provider = new ResendEmailProvider(configService());

      await provider.sendInvitationEmail({ to: 'b@b.com', organizationName: 'Acme', token: 'raw-token' });

      const [payload] = sendMock.mock.calls[0] as [{ to: string[]; html: string }];
      expect(payload.to).toEqual(['b@b.com']);
      expect(payload.html).toContain('Acme');
      expect(payload.html).toContain('raw-token');
    });
  });
});
