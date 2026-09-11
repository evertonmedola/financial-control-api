import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/main';

// Both describe blocks apply the SAME `configureApp()` used by the real
// `bootstrap()` in src/main.ts — Nest's `Test.createTestingModule()` +
// `createNestApplication()` never calls `bootstrap()`, so helmet/CORS/the
// global exception filter would otherwise be silently absent from every
// e2e test (the same class of bug documented as a Rule 1 fix in
// 01-01-SUMMARY.md for ValidationPipe/interceptors).

interface ErrorBody {
  statusCode?: number;
  message?: string;
}

describe('security headers', () => {
  let app: INestApplication;
  let allowedOrigin: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const configService = app.get(ConfigService);
    const origins = configService
      .getOrThrow<string>('ALLOWED_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
    [allowedOrigin] = origins;
  });

  afterAll(async () => {
    await app.close();
  });

  it('helmet applies standard security headers to every response', async () => {
    const response = await request(app.getHttpServer()).get('/auth/me');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-dns-prefetch-control']).toBeDefined();
  });

  it('does not return a matching Access-Control-Allow-Origin for a disallowed origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Origin', 'http://evil.example');

    expect(response.headers['access-control-allow-origin']).not.toBe(
      'http://evil.example',
    );
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns a matching Access-Control-Allow-Origin for an allowlisted origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Origin', allowedOrigin);

    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
  });
});

describe('error sanitization', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Only `findById` is exercised by this suite (via GET /auth/me) — the
      // mock intentionally omits register/login since a JWT is minted
      // directly via JwtService below, bypassing those endpoints entirely.
      .overrideProvider(AuthService)
      .useValue({
        findById: () => {
          const error = new Error('unexpected database failure');
          error.stack = [
            'Error: unexpected database failure',
            '    at AuthService.findById (/app/src/auth/auth.service.ts:70:11)',
            '    at AuthController.me (/app/src/auth/auth.controller.ts:44:34)',
          ].join('\n');
          throw error;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    // JwtStrategy.validate() is stateless (no DB lookup, see jwt.strategy.ts)
    // so a token signed directly via JwtService is sufficient to reach the
    // guarded route without going through the (overridden) register/login flow.
    const jwtService = moduleFixture.get<JwtService>(JwtService);
    accessToken = await jwtService.signAsync({
      sub: 'fake-user-id-for-error-sanitization-test',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('never leaks a stack trace or file path for an unhandled exception', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(500);

    const body = response.body as ErrorBody;
    expect(body.message).toBe('Internal server error');

    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/\.(ts|js):\d+:\d+/);
    expect(raw).not.toMatch(/at\s+[\w.]+\s*\(/);
    expect(raw).not.toContain('auth.service.ts');
    expect(raw).not.toContain('unexpected database failure');
  });
});
