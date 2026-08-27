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
});
