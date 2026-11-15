import { ConsoleEmailProvider } from './console-email.provider';

describe('ConsoleEmailProvider', () => {
  it('loga o convite (destinatário, organização e token) em vez de enviar de verdade', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const provider = new ConsoleEmailProvider();

    await provider.sendInvitationEmail({
      to: 'b@b.com',
      organizationName: 'Acme',
      token: 'raw-invitation-token',
    });

    const logged = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('b@b.com');
    expect(logged).toContain('Acme');
    expect(logged).toContain('raw-invitation-token');

    logSpy.mockRestore();
  });

  it('loga um email genérico (sendEmail) em vez de enviar de verdade, retornando id null', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const provider = new ConsoleEmailProvider();

    const result = await provider.sendEmail({ to: 'lead@example.com', subject: 'Assunto X', html: '<p>Corpo</p>' });

    expect(result).toEqual({ id: null });
    const logged = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('lead@example.com');
    expect(logged).toContain('Assunto X');

    logSpy.mockRestore();
  });
});
