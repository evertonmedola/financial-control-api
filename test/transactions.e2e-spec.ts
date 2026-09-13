import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same ThrottlerGuard no-op override as accounts.e2e-spec.ts/
// categories.e2e-spec.ts.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface TransactionData {
  id?: string;
  type?: string;
  amount?: string;
  accountId?: string;
  fromAccountId?: string | null;
  toAccountId?: string | null;
  categoryId?: string;
  description?: string;
  date?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AccountData {
  id?: string;
  balance?: string;
}

interface CategoryData {
  id?: string;
}

interface AuthData {
  accessToken?: string;
  refreshToken?: string;
}

interface EnvelopeBody<T> {
  data?: T;
  timestamp?: string;
}

describe('Transactions (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let accountId: string;
  let categoryId: string;

  const uniqueEmail = () =>
    `transactions-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

    const accountResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Conta Testes', type: 'corrente', balance: '1000.00' });
    accountId = (accountResponse.body as EnvelopeBody<AccountData>).data
      ?.id as string;

    const categoryResponse = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Alimentação', type: 'despesa' });
    categoryId = (categoryResponse.body as EnvelopeBody<CategoryData>).data
      ?.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create transaction', () => {
    it('POST /transactions creates an expense and updates the linked account balance in the same request', async () => {
      const response = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '100.00',
          accountId,
          categoryId,
          description: 'Mercado',
          date: '2026-09-13',
        });

      expect(response.status).toBe(201);
      const body = (response.body as EnvelopeBody<TransactionData>).data;
      expect(body?.id).toBeDefined();
      expect(body?.type).toBe('expense');
      expect(body?.amount).toBe('100.00');
      expect(body?.accountId).toBe(accountId);

      const accountResponse = await request(app.getHttpServer())
        .get(`/accounts/${accountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(
        (accountResponse.body as EnvelopeBody<AccountData>).data?.balance,
      ).toBe('900.00');
    });
  });
});
