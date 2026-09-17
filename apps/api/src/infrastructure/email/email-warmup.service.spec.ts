import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { EmailWarmupService } from './email-warmup.service';

describe('EmailWarmupService', () => {
  let service: EmailWarmupService;
  let redis: { get: jest.Mock; incr: jest.Mock; expire: jest.Mock };
  let configValues: Record<string, string | undefined>;

  beforeEach(async () => {
    redis = { get: jest.fn().mockResolvedValue(null), incr: jest.fn(), expire: jest.fn() };
    configValues = {};

    const module = await Test.createTestingModule({
      providers: [
        EmailWarmupService,
        { provide: RedisService, useValue: redis },
        { provide: ConfigService, useValue: { get: (key: string) => configValues[key] } },
      ],
    }).compile();

    service = module.get(EmailWarmupService);
  });

  function isoToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  describe('checkCanSend — teto de volume diário', () => {
    it('sem RESEND_DOMAIN_WARMUP_STARTED_AT configurada, nunca aplica teto de volume', async () => {
      redis.get.mockImplementation((key: string) => (key.startsWith('email-warmup:sent:') ? '999999' : null));

      const status = await service.checkCanSend();

      expect(status).toEqual({ blocked: false });
    });

    it('dia 1 de aquecimento: bloqueia ao atingir 150 e-mails enviados hoje', async () => {
      configValues.RESEND_DOMAIN_WARMUP_STARTED_AT = isoToday();
      redis.get.mockImplementation((key: string) => (key.startsWith('email-warmup:sent:') ? '150' : null));

      const status = await service.checkCanSend();

      expect(status.blocked).toBe(true);
      expect(status.reason).toMatch(/150\/150/);
    });

    it('dia 1 de aquecimento: permite abaixo do teto (149 enviados)', async () => {
      configValues.RESEND_DOMAIN_WARMUP_STARTED_AT = isoToday();
      redis.get.mockImplementation((key: string) => (key.startsWith('email-warmup:sent:') ? '149' : null));

      const status = await service.checkCanSend();

      expect(status).toEqual({ blocked: false });
    });

    it('8+ dias depois do início, o cronograma acabou e não há mais teto de volume', async () => {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 10);
      configValues.RESEND_DOMAIN_WARMUP_STARTED_AT = start.toISOString().slice(0, 10);
      redis.get.mockImplementation((key: string) => (key.startsWith('email-warmup:sent:') ? '5000' : null));

      const status = await service.checkCanSend();

      expect(status).toEqual({ blocked: false });
    });
  });

  describe('checkCanSend — pausa por taxa de bounce/reclamação', () => {
    it('não aplica a checagem de taxa abaixo do volume mínimo de amostra (24 enviados)', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key.startsWith('email-warmup:sent:')) return '24';
        if (key.startsWith('email-warmup:bounced:')) return '24'; // 100% bounce, mas amostra pequena demais
        return null;
      });

      const status = await service.checkCanSend();

      expect(status).toEqual({ blocked: false });
    });

    it('bloqueia quando a taxa de bounce do dia passa de 4%, a partir do volume mínimo', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key.startsWith('email-warmup:sent:')) return '100';
        if (key.startsWith('email-warmup:bounced:')) return '5'; // 5%
        if (key.startsWith('email-warmup:complained:')) return '0';
        return null;
      });

      const status = await service.checkCanSend();

      expect(status.blocked).toBe(true);
      expect(status.reason).toMatch(/bounce/);
    });

    it('bloqueia quando a taxa de reclamação de spam do dia passa de 0.08%, a partir do volume mínimo', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key.startsWith('email-warmup:sent:')) return '1000';
        if (key.startsWith('email-warmup:bounced:')) return '0';
        if (key.startsWith('email-warmup:complained:')) return '2'; // 0.2%
        return null;
      });

      const status = await service.checkCanSend();

      expect(status.blocked).toBe(true);
      expect(status.reason).toMatch(/reclamação/);
    });

    it('permite quando as taxas estão dentro do limite seguro', async () => {
      redis.get.mockImplementation((key: string) => {
        if (key.startsWith('email-warmup:sent:')) return '1000';
        if (key.startsWith('email-warmup:bounced:')) return '10'; // 1%
        if (key.startsWith('email-warmup:complained:')) return '0';
        return null;
      });

      const status = await service.checkCanSend();

      expect(status).toEqual({ blocked: false });
    });
  });

  describe('recordSent/recordBounced/recordComplained', () => {
    it('recordSent incrementa a chave do dia e define TTL só na primeira escrita', async () => {
      await service.recordSent();

      const [key] = redis.incr.mock.calls[0];
      expect(key).toMatch(/^email-warmup:sent:\d{4}-\d{2}-\d{2}$/);
      expect(redis.expire).toHaveBeenCalledWith(key, expect.any(Number), 'NX');
    });

    it('recordBounced e recordComplained usam suas próprias chaves diárias', async () => {
      await service.recordBounced();
      await service.recordComplained();

      expect(redis.incr.mock.calls[0][0]).toMatch(/^email-warmup:bounced:\d{4}-\d{2}-\d{2}$/);
      expect(redis.incr.mock.calls[1][0]).toMatch(/^email-warmup:complained:\d{4}-\d{2}-\d{2}$/);
    });
  });
});
