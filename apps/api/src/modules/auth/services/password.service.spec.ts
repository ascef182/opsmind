import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  describe('hash', () => {
    it('produz um hash diferente da senha em texto plano', async () => {
      const hashed = await service.hash('correct horse battery staple');

      expect(hashed).not.toBe('correct horse battery staple');
      expect(hashed.length).toBeGreaterThan(0);
    });
  });

  describe('verify', () => {
    it('retorna true quando a senha em texto plano corresponde ao hash', async () => {
      const hashed = await service.hash('correct horse battery staple');

      await expect(service.verify('correct horse battery staple', hashed)).resolves.toBe(true);
    });

    it('retorna false quando a senha em texto plano não corresponde ao hash', async () => {
      const hashed = await service.hash('correct horse battery staple');

      await expect(service.verify('wrong password', hashed)).resolves.toBe(false);
    });
  });
});
