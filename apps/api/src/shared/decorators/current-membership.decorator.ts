import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Exportada separadamente da factory do `createParamDecorator` para ser testável em isolamento. */
export const currentMembershipFactory = (_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest();
  return request.membership;
};

/** `@CurrentMembership()` — extrai `req.membership`, populado pelo `TenantGuard`. */
export const CurrentMembership = createParamDecorator(currentMembershipFactory);
