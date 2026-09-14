import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Dedicated two-user IDOR/cross-tenant regression suite for the Transactions
// module, mirroring test/categories-cross-tenant.e2e-spec.ts's exact
// structure. Proves every GET/PATCH/DELETE /transactions/:id route returns
// 404 (never 403, never 200) when the id belongs to a different tenant, and
// that GET /transactions never leaks another tenant's transaction ids into
// the caller's list.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface TransactionData {
  id?: string;
  description?: string;
}

interface AccountData {
  id?: string;
}

interface CategoryData {
  id?: string;
}

interface AuthData {
  id?: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface EnvelopeBody<T> {
  data?: T;
  timestamp?: string;
}

interface Session {
  email: string;
  id: string;
  accessToken: string;
  accountId: string;
  categoryId: string;
}

describe('Transactions cross-tenant isolation (e2e)', () => {
  let app: INestApplication;

  const uniqueEmail = (label: string) =>
    `transactions-cross-tenant-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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
  });

  afterAll(async () => {
    await app.close();
  });

  const registerAndLogin = async (label: string): Promise<Session> => {
    const email = uniqueEmail(label);

    const registerResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const id = (registerResponse.body as EnvelopeBody<AuthData>).data
      ?.id as string;

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const accessToken = (loginResponse.body as EnvelopeBody<AuthData>).data
      ?.accessToken as string;

    const accountResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: `Conta ${label}`, type: 'corrente', balance: '1000.00' })
      .expect(201);
    const accountId = (accountResponse.body as EnvelopeBody<AccountData>).data
      ?.id as string;

    const categoryResponse = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: `Categoria ${label}`, type: 'despesa' })
      .expect(201);
    const categoryId = (categoryResponse.body as EnvelopeBody<CategoryData>)
      .data?.id as string;

    return { email, id, accessToken, accountId, categoryId };
  };

  const createTransaction = async (
    session: Session,
    description: string,
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        type: 'expense',
        amount: '10.00',
        accountId: session.accountId,
        categoryId: session.categoryId,
        description,
        date: '2026-09-13',
      })
      .expect(201);
    return (response.body as EnvelopeBody<TransactionData>).data?.id as string;
  };

  it("GET /transactions/:id with B's transaction id and A's token returns 404, never 403/200", async () => {
    const userA = await registerAndLogin('get-a');
    const userB = await registerAndLogin('get-b');
    const bTransactionId = await createTransaction(userB, "B's transaction");

    const response = await request(app.getHttpServer())
      .get(`/transactions/${bTransactionId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(404);
  });

  it("PATCH /transactions/:id with B's transaction id and A's token returns 404, never 403/200 — and B's transaction is untouched", async () => {
    const userA = await registerAndLogin('patch-a');
    const userB = await registerAndLogin('patch-b');
    const bTransactionId = await createTransaction(userB, "B's transaction");

    const response = await request(app.getHttpServer())
      .patch(`/transactions/${bTransactionId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ description: 'Hijacked description' });

    expect(response.status).toBe(404);

    const stillB = await request(app.getHttpServer())
      .get(`/transactions/${bTransactionId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(stillB.status).toBe(200);
    expect(
      (stillB.body as EnvelopeBody<TransactionData>).data?.description,
    ).toBe("B's transaction");
  });

  it("DELETE /transactions/:id with B's transaction id and A's token returns 404, never 403/200 — and B's transaction is not deleted", async () => {
    const userA = await registerAndLogin('delete-a');
    const userB = await registerAndLogin('delete-b');
    const bTransactionId = await createTransaction(userB, "B's transaction");

    const response = await request(app.getHttpServer())
      .delete(`/transactions/${bTransactionId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(404);

    const stillB = await request(app.getHttpServer())
      .get(`/transactions/${bTransactionId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(stillB.status).toBe(200);
  });

  it("GET /transactions for A never includes any of B's transaction ids", async () => {
    const userA = await registerAndLogin('list-a');
    const userB = await registerAndLogin('list-b');
    await createTransaction(userA, "A's transaction 1");
    await createTransaction(userA, "A's transaction 2");
    const bTransactionId1 = await createTransaction(userB, "B's transaction 1");
    const bTransactionId2 = await createTransaction(userB, "B's transaction 2");

    const response = await request(app.getHttpServer())
      .get('/transactions')
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(200);
    const ids = (
      (response.body as EnvelopeBody<TransactionData[]>).data ?? []
    ).map((transaction) => transaction.id);
    expect(ids).not.toContain(bTransactionId1);
    expect(ids).not.toContain(bTransactionId2);
  });
});
