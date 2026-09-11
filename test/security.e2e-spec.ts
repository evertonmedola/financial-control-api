import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

// Applies the SAME `configureApp()` used by the real `bootstrap()` in
// src/main.ts — Nest's `Test.createTestingModule()` + `createNestApplication()`
// never calls `bootstrap()`, so helmet/CORS would otherwise be silently
// absent from every e2e test (the same class of bug documented as a Rule 1
// fix in 01-01-SUMMARY.md for ValidationPipe/interceptors).

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

    expect(response.headers['access-control-allow-origin']).toBe(
      allowedOrigin,
    );
  });
});
