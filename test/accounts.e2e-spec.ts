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
    accessToken =
      (loginResponse.body as EnvelopeBody<AuthData>).data?.accessToken ?? '';
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

    it.each([
      ['poupanca', '500.00'],
      ['carteira', '500.00'],
      ['cartao_credito', '500.00'],
    ])(
      'POST /accounts creates a %s account and returns the balance unchanged (D-01/ACCT-03: credit card balance stays a positive "amount owed")',
      async (type, balance) => {
        const response = await request(app.getHttpServer())
          .post('/accounts')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: `Conta ${type}`, type, balance });

        expect(response.status).toBe(201);
        const body = (response.body as EnvelopeBody<AccountData>).data;
        expect(body?.type).toBe(type);
        expect(body?.balance).toBe(balance);
      },
    );

    it('round-trips a decimal balance exactly, never floating-point-altered (Pitfall 1)', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Precisao', type: 'corrente', balance: '1234.56' });

      expect(response.status).toBe(201);
      const body = (response.body as EnvelopeBody<AccountData>).data;
      expect(body?.balance).toBe('1234.56');
      expect(typeof body?.balance).toBe('string');
    });

    it('rejects a balance with more than 2 decimal places with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Invalida', type: 'corrente', balance: '10.999' });

      expect(response.status).toBe(400);
    });

    it('accepts a balance with exactly 2 decimal places with 201', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Valida', type: 'corrente', balance: '10.99' });

      expect(response.status).toBe(201);
    });

    it.each(['0.00', '-100.00'])(
      'accepts a %s balance for a corrente account at creation (CONTEXT.md discretion: accounts can start overdrawn)',
      async (balance) => {
        const response = await request(app.getHttpServer())
          .post('/accounts')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Conta Zero Ou Negativa', type: 'corrente', balance });

        expect(response.status).toBe(201);
      },
    );

    it('creation is not idempotent — two identical POST /accounts calls create two distinct accounts', async () => {
      const body = { name: 'Duplicada', type: 'corrente', balance: '10.00' };

      const first = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);
      const second = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (first.body as EnvelopeBody<AccountData>).data?.id;
      const secondId = (second.body as EnvelopeBody<AccountData>).data?.id;
      expect(firstId).toBeDefined();
      expect(secondId).toBeDefined();
      expect(firstId).not.toBe(secondId);
    });

    it('two concurrent POST /accounts calls for the same user both succeed with distinct ids (no unique constraint blocks parallel creation)', async () => {
      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/accounts')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Concorrente A', type: 'corrente', balance: '20.00' }),
        request(app.getHttpServer())
          .post('/accounts')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Concorrente B', type: 'corrente', balance: '20.00' }),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (first.body as EnvelopeBody<AccountData>).data?.id;
      const secondId = (second.body as EnvelopeBody<AccountData>).data?.id;
      expect(firstId).not.toBe(secondId);
    });

    it('rejects an invalid/unrecognized type with 400 — never silently coerced to a default (prohibition P1)', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Tipo Invalido',
          type: 'invalid-type',
          balance: '10.00',
        });

      expect(response.status).toBe(400);
    });

    it('rejects a client-supplied userId field with 400 instead of honoring it (Pitfall 3 / IDOR)', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta IDOR',
          type: 'corrente',
          balance: '10.00',
          userId: '11111111-1111-1111-1111-111111111111',
        });

      expect(response.status).toBe(400);
    });
  });
});
