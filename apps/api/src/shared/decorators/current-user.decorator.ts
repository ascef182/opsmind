import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Exportada separadamente da factory do `createParamDecorator` para ser testável em isolamento. */
export const currentUserFactory = (_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest();
  return request.user;
};

/** `@CurrentUser()` — extrai `req.user`, populado pelo `JwtAccessStrategy`. */
export const CurrentUser = createParamDecorator(currentUserFactory);
