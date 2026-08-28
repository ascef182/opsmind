import { createLogger } from './logger';

describe('createLogger', () => {
  it('usa o LOG_LEVEL informado', () => {
    const logger = createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'warn' } as never);

    expect(logger.level).toBe('warn');
  });

  it('inclui um campo fixo "service" pra distinguir logs do worker dos da API no agregador', () => {
    const logger = createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'info' } as never);

    expect(logger.bindings()).toEqual(expect.objectContaining({ service: 'opsmind-worker' }));
  });
});
