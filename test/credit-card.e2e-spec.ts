import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same ThrottlerGuard no-op override as transfers.e2e-spec.ts.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface AccountData {
  id?: string;
  balance?: string;
}

interface NetBalanceData {
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

describe('Credit card balance semantics (e2e)', () => {
  let app: INestApplication;

  const password = 'super-secret-password';

  // Registers a fresh, isolated user and returns its access token, so exact
  // equality assertions on the net balance are safe.
  const registerUser = async (): Promise<string> => {
    const email = `credit-card-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return (
      (loginResponse.body as EnvelopeBody<AuthData>).data?.accessToken ?? ''
    );
  };

  const createAccount = async (
    token: string,
    type: string,
    balance: string,
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Conta ${Math.random()}`, type, balance })
      .expect(201);
    return (response.body as EnvelopeBody<AccountData>).data?.id as string;
  };

  const createExpenseCategory = async (token: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Compras', type: 'despesa' })
      .expect(201);
    return (response.body as EnvelopeBody<CategoryData>).data?.id as string;
  };

  const createExpense = async (
    token: string,
    accountId: string,
    categoryId: string,
    amount: string,
  ): Promise<void> => {
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'expense',
        amount,
        accountId,
        categoryId,
        description: 'Compra no cartão',
        date: '2026-09-13',
      })
      .expect(201);
  };

  const getAccountBalance = async (
    token: string,
    id: string,
  ): Promise<string | undefined> => {
    const response = await request(app.getHttpServer())
      .get(`/accounts/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (response.body as EnvelopeBody<AccountData>).data?.balance;
  };

  const getNetBalance = async (token: string): Promise<string | undefined> => {
    const response = await request(app.getHttpServer())
      .get('/reports/net-balance')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (response.body as EnvelopeBody<NetBalanceData>).data?.balance;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerGuard)
      .useValue(noopThrottlerGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('a cartao_credito created at 0.00 and charged R$ 100 reads -100.00 and nets -100.00 (tracer)', async () => {
    const token = await registerUser();
    const cardId = await createAccount(token, 'cartao_credito', '0.00');
    const categoryId = await createExpenseCategory(token);

    await createExpense(token, cardId, categoryId, '100.00');

    expect(await getAccountBalance(token, cardId)).toBe('-100.00');
    expect(await getNetBalance(token)).toBe('-100.00');
  });
});
