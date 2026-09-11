import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Global ValidationPipe, ClassSerializerInterceptor, and ResponseInterceptor
// are registered as DI providers in AppModule (APP_PIPE / APP_INTERCEPTOR),
// not imperatively here — that way they're active in every INestApplication
// built from AppModule, including e2e tests that never call this bootstrap().
//
// helmet() and enableCors() have no DI-provider equivalent — they're only
// applicable on a constructed INestApplication instance. Extracted here
// (rather than left inline in bootstrap()) and exported so
// test/security.e2e-spec.ts can apply the byte-identical transport
// hardening to its own TestingModule-built app; otherwise this
// configuration would be silently absent from every e2e test the same way
// ValidationPipe/interceptors were before the 01-01 Rule 1 fix (see
// 01-01-SUMMARY.md).
export function configureApp(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const allowedOrigins = configService
    .getOrThrow<string>('ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.use(helmet());
  // Explicit allowlist only — never '*' and never `origin: true` (security-
  // review checklist: "CORS configurado com origem explícita, nunca *").
  app.enableCors({ origin: allowedOrigins, credentials: true });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);
}

// Only auto-run when this file is the process entrypoint (`node dist/main`).
// test/security.e2e-spec.ts imports `configureApp` from this same file to
// stay byte-identical with production bootstrap — without this guard, that
// import would ALSO trigger a real `app.listen()`, crashing the test run
// with EADDRINUSE and leaking an open HTTP server.
if (require.main === module) {
  void bootstrap();
}
