import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface RequestWithUser {
  user: { userId: string };
}

// The ownership-scoping primitive every domain module (Phase 2+) imports and
// uses identically. userId is sourced exclusively from JwtStrategy.validate()
// (request.user.userId) — never from a client-supplied query/body field.
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user.userId;
  },
);
