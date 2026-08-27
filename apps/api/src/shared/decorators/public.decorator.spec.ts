import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, Public } from './public.decorator';

describe('@Public()', () => {
  it('marca o handler com IS_PUBLIC_KEY = true, legível via Reflector', () => {
    class TestController {
      @Public()
      handler() {}
    }

    const reflector = new Reflector();
    const isPublic = reflector.get(IS_PUBLIC_KEY, TestController.prototype.handler);

    expect(isPublic).toBe(true);
  });

  it('não marca handlers sem o decorator', () => {
    class TestController {
      handler() {}
    }

    const reflector = new Reflector();
    const isPublic = reflector.get(IS_PUBLIC_KEY, TestController.prototype.handler);

    expect(isPublic).toBeUndefined();
  });
});
