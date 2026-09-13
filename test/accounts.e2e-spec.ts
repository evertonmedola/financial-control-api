import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same ThrottlerGuard no-op override as auth.e2e-spec.ts/cross-tenant.e2e-spec.ts
// — this suite issues one register+login call per describe block, well
// within the login/register limits individually, but shares a single app
// instance/throttler bucket across the whole file.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface AccountData {
  id?: string;
  name?: string;
  type?: string;
  balance?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AuthData {
  accessToken?: string;
  refreshToken?: string;
}

interface EnvelopeBody<T> {
  data?: T;
  timestamp?: string;
}

describe('Accounts (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  const uniqueEmail = () =>
    `accounts-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'super-secret-password';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerGuard)
      .useValue(noopThrottlerGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    accessToken = ((loginResponse.body as EnvelopeBody<AuthData>).data
      ?.accessToken ?? '') as string;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create account', () => {
    it('POST /accounts creates a corrente account and returns 201 with the created account', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Corrente', type: 'corrente', balance: '1000.00' });

      expect(response.status).toBe(201);
      const body = (response.body as EnvelopeBody<AccountData>).data;
      expect(body?.id).toBeDefined();
      expect(body?.name).toBe('Conta Corrente');
      expect(body?.type).toBe('corrente');
      expect(body?.balance).toBe('1000.00');
      expect(body?.createdAt).toBeDefined();
    });
  });
});
