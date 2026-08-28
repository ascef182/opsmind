import { buildLoggerOptions } from './logger-options';

/** A implementação sempre usa a forma-objeto de `redact` (nunca string[]) — ver logger-options.ts. */
function redactOf(options: ReturnType<typeof buildLoggerOptions>) {
  return options.redact as { paths: string[]; censor: string } | undefined;
}

describe('buildLoggerOptions', () => {
  it('usa o nível informado e formato JSON puro (sem transport) em produção', () => {
    const options = buildLoggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'warn' } as never);

    expect(options.level).toBe('warn');
    expect(options.transport).toBeUndefined();
  });

  it('usa pino-pretty (transport) fora de produção, pra log legível no terminal de dev', () => {
    const options = buildLoggerOptions({ NODE_ENV: 'development', LOG_LEVEL: 'debug' } as never);

    expect(options.level).toBe('debug');
    expect(options.transport).toEqual(expect.objectContaining({ target: 'pino-pretty' }));
  });

  it('redige o Authorization header e o corpo de senha/tokens, nunca loga segredo em texto puro', () => {
    const options = buildLoggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' } as never);

    expect(redactOf(options)?.paths).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.body.password',
        'req.body.refreshToken',
        'req.body.accessToken',
      ]),
    );
    expect(redactOf(options)?.censor).toBe('[REDACTED]');
  });
});
