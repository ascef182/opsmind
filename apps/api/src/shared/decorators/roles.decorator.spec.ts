import { Reflector } from '@nestjs/core';
import { ROLES_KEY, Roles } from './roles.decorator';

describe('@Roles()', () => {
  it('grava os papéis passados como metadata ROLES_KEY, legível via Reflector', () => {
    class TestController {
      @Roles('ADMIN', 'OWNER')
      handler() {}
    }

    const reflector = new Reflector();
    const roles = reflector.get(ROLES_KEY, TestController.prototype.handler);

    expect(roles).toEqual(['ADMIN', 'OWNER']);
  });
});
