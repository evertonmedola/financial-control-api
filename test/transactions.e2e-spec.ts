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

    it('POST /transactions creates an income and increases the linked account balance by the exact amount', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Renda', type: 'corrente', balance: '1000.00' });
      const incomeAccountId = (account.body as EnvelopeBody<AccountData>).data
        ?.id as string;
      const receitaCategory = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Salário', type: 'receita' });
      const receitaCategoryId = (
        receitaCategory.body as EnvelopeBody<CategoryData>
      ).data?.id as string;

      const response = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'income',
          amount: '500.00',
          accountId: incomeAccountId,
          categoryId: receitaCategoryId,
          description: 'Salário',
          date: '2026-09-13',
        });

      expect(response.status).toBe(201);

      const accountResponse = await request(app.getHttpServer())
        .get(`/accounts/${incomeAccountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(
        (accountResponse.body as EnvelopeBody<AccountData>).data?.balance,
      ).toBe('1500.00');
    });

    it('rejects amount "0.00" and "0" with 400, but accepts "0.01" with 201 (edge-probe: boundary)', async () => {
      const zeroPadded = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '0.00',
          accountId,
          categoryId,
          description: 'Zero',
          date: '2026-09-13',
        });
      expect(zeroPadded.status).toBe(400);

      const zeroBare = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '0',
          accountId,
          categoryId,
          description: 'Zero',
          date: '2026-09-13',
        });
      expect(zeroBare.status).toBe(400);

      const smallestAccepted = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '0.01',
          accountId,
          categoryId,
          description: 'Menor valor aceito',
          date: '2026-09-13',
        });
      expect(smallestAccepted.status).toBe(201);
    });

    it('rejects a negative amount with 400 — the balance-effect sign comes only from `type` (Prohibition)', async () => {
      const response = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '-10.00',
          accountId,
          categoryId,
          description: 'Negativo',
          date: '2026-09-13',
        });

      expect(response.status).toBe(400);
    });

    it('rejects an amount whose integer part overflows numeric(12,2) with 400, never a raw 500 (edge-probe: boundary)', async () => {
      const response = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '12345678901.00',
          accountId,
          categoryId,
          description: 'Overflow',
          date: '2026-09-13',
        });

      expect(response.status).toBe(400);
    });

    it('rejects an amount with more than 2 decimal places with 400, never silently truncated/rounded (TXN-05, Prohibition)', async () => {
      const response = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '10.567',
          accountId,
          categoryId,
          description: 'Precisao demais',
          date: '2026-09-13',
        });

      expect(response.status).toBe(400);
    });

    it('round-trips a precise amount exactly — "1234.56" returns data.amount === "1234.56" (TXN-05)', async () => {
      const response = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '1234.56',
          accountId,
          categoryId,
          description: 'Valor preciso',
          date: '2026-09-13',
        });

      expect(response.status).toBe(201);
      expect(
        (response.body as EnvelopeBody<TransactionData>).data?.amount,
      ).toBe('1234.56');
    });

    it('rejects type "transfer" with 400 — this endpoint only ever accepts income/expense (D-02)', async () => {
      const response = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'transfer',
          amount: '10.00',
          accountId,
          categoryId,
          description: 'Transferencia invalida',
          date: '2026-09-13',
        });

      expect(response.status).toBe(400);
    });

    it('two sequential identical POSTs create two distinct rows — not idempotent by design (edge-probe: idempotency)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Idempotencia',
          type: 'corrente',
          balance: '1000.00',
        });
      const idempotencyAccountId = (account.body as EnvelopeBody<AccountData>)
        .data?.id as string;
      const body = {
        type: 'expense',
        amount: '50.00',
        accountId: idempotencyAccountId,
        categoryId,
        description: 'Repetido',
        date: '2026-09-13',
      };

      const first = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);
      const second = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (first.body as EnvelopeBody<TransactionData>).data?.id;
      const secondId = (second.body as EnvelopeBody<TransactionData>).data?.id;
      expect(firstId).not.toBe(secondId);

      const accountResponse = await request(app.getHttpServer())
        .get(`/accounts/${idempotencyAccountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(
        (accountResponse.body as EnvelopeBody<AccountData>).data?.balance,
      ).toBe('900.00');
    });

    it('two concurrent expense creations against the same account never lose an update (edge-probe: concurrency, Pitfall 2)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Concorrencia',
          type: 'corrente',
          balance: '1000.00',
        });
      const concurrencyAccountId = (account.body as EnvelopeBody<AccountData>)
        .data?.id as string;

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            type: 'expense',
            amount: '100.00',
            accountId: concurrencyAccountId,
            categoryId,
            description: 'Concorrente 1',
            date: '2026-09-13',
          }),
        request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            type: 'expense',
            amount: '100.00',
            accountId: concurrencyAccountId,
            categoryId,
            description: 'Concorrente 2',
            date: '2026-09-13',
          }),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);

      const accountResponse = await request(app.getHttpServer())
        .get(`/accounts/${concurrencyAccountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(
        (accountResponse.body as EnvelopeBody<AccountData>).data?.balance,
      ).toBe('800.00');
    });

    it('an accountId or categoryId belonging to another user returns 404, never 403/201 (Pitfall 3, IDOR)', async () => {
      const otherEmail = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: otherEmail, password })
        .expect(201);
      const otherLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: otherEmail, password })
        .expect(200);
      const otherAccessToken =
        (otherLogin.body as EnvelopeBody<AuthData>).data?.accessToken ?? '';

      const otherAccount = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${otherAccessToken}`)
        .send({ name: 'Conta de Outro', type: 'corrente', balance: '0.00' });
      const otherAccountId = (otherAccount.body as EnvelopeBody<AccountData>)
        .data?.id as string;

      const otherCategory = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${otherAccessToken}`)
        .send({ name: 'Categoria de Outro', type: 'despesa' });
      const otherCategoryId = (otherCategory.body as EnvelopeBody<CategoryData>)
        .data?.id as string;

      const crossAccount = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '10.00',
          accountId: otherAccountId,
          categoryId,
          description: 'IDOR account',
          date: '2026-09-13',
        });
      expect(crossAccount.status).toBe(404);

      const crossCategory = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '10.00',
          accountId,
          categoryId: otherCategoryId,
          description: 'IDOR category',
          date: '2026-09-13',
        });
      expect(crossCategory.status).toBe(404);
    });

    it('rejects a client-supplied userId field with 400 instead of honoring it (Pitfall 3 / IDOR)', async () => {
      const response = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '10.00',
          accountId,
          categoryId,
          description: 'IDOR userId',
          date: '2026-09-13',
          userId: '11111111-1111-1111-1111-111111111111',
        });

      expect(response.status).toBe(400);
    });
  });
});
