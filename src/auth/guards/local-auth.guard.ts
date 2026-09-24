import { ExecutionContext, Injectable, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LoginDto } from '../dto/login.dto';

// Mirrors AppModule's global APP_PIPE exactly (whitelist + forbidNonWhitelisted
// + transform) so this guard's early shape-check rejects payloads for the
// same reasons and with the same response shape the global pipe would have.
const loginBodyValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

/**
 * WR-04 fix: NestJS runs Guards before Pipes, so the stock `AuthGuard('local')`
 * called `LocalStrategy.validate()` — a full DB round-trip + argon2 verify —
 * *before* the `@Body() LoginDto` pipe ever inspected the payload's shape.
 * That meant a malformed login body (unexpected extra fields, wrong types)
 * still paid the full authentication cost and only got rejected afterward
 * (400, from the pipe), while genuinely wrong credentials never reached the
 * pipe at all (401, from this guard) — two different rejection mechanisms
 * and status codes depending on credential validity for the same kind of
 * "reject this request" outcome.
 *
 * Running the SAME shape of validation the global pipe applies — here,
 * before delegating to the real passport authentication — makes malformed
 * payloads fail fast with zero DB/argon2 work, while legitimate payloads
 * flow through unchanged into the normal guard -> strategy -> argon2 path.
 */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ body: unknown }>();
    request.body = await loginBodyValidationPipe.transform(request.body, {
      type: 'body',
      metatype: LoginDto,
    });

    return (await super.canActivate(context)) as boolean;
  }
}
