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

    it('12 sequential alternating income/expense transactions against a single account yield the exact hand-computed final balance — integration-level precision invariant (TXN-05)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Precisao Integracao',
          type: 'corrente',
          balance: '0.00',
        });
      const precisionAccountId = (account.body as EnvelopeBody<AccountData>)
        .data?.id as string;

      // 6x income '10.10' + 6x expense '3.33', fired sequentially (not
      // concurrently — this proves accumulation precision, not locking,
      // which the dedicated concurrency test above already covers).
      // Expected: 6*10.10 - 6*3.33 = 60.60 - 19.98 = 40.62 exactly, with no
      // float drift through DTO validation -> QueryRunner transaction ->
      // adjustBalance -> decimal(12,2) column round trip.
      for (let i = 0; i < 6; i++) {
        await request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            type: 'income',
            amount: '10.10',
            accountId: precisionAccountId,
            categoryId,
            description: `Precisao income ${i}`,
            date: '2026-09-13',
          })
          .expect(201);

        await request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            type: 'expense',
            amount: '3.33',
            accountId: precisionAccountId,
            categoryId,
            description: `Precisao expense ${i}`,
            date: '2026-09-13',
          })
          .expect(201);
      }

      const accountAfter = await request(app.getHttpServer())
        .get(`/accounts/${precisionAccountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(
        (accountAfter.body as EnvelopeBody<AccountData>).data?.balance,
      ).toBe('40.62');
    });
  });

  describe('list/view/update/delete transaction', () => {
    it('GET /transactions on a freshly-registered user with zero transactions returns 200 with an empty array (edge-probe: empty)', async () => {
      const freshEmail = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: freshEmail, password })
        .expect(201);
      const freshLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: freshEmail, password })
        .expect(200);
      const freshAccessToken =
        (freshLogin.body as EnvelopeBody<AuthData>).data?.accessToken ?? '';

      const response = await request(app.getHttpServer())
        .get('/transactions')
        .set('Authorization', `Bearer ${freshAccessToken}`);

      expect(response.status).toBe(200);
      expect((response.body as EnvelopeBody<TransactionData[]>).data).toEqual(
        [],
      );
    });

    it('GET /transactions returns transactions ordered by date DESC regardless of creation order (edge-probe: ordering)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Ordenacao', type: 'corrente', balance: '0.00' });
      const orderingAccountId = (account.body as EnvelopeBody<AccountData>).data
        ?.id as string;

      const dates = ['2026-09-01', '2026-09-10', '2026-09-05'];
      for (const date of dates) {
        await request(app.getHttpServer())
          .post('/transactions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            type: 'expense',
            amount: '1.00',
            accountId: orderingAccountId,
            categoryId,
            description: `Data ${date}`,
            date,
          })
          .expect(201);
      }

      const response = await request(app.getHttpServer())
        .get('/transactions')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(response.status).toBe(200);
      const ownDates = (
        (response.body as EnvelopeBody<TransactionData[]>).data ?? []
      )
        .filter((t) => t.accountId === orderingAccountId)
        .map((t) => t.date);
      expect(ownDates).toEqual(['2026-09-10', '2026-09-05', '2026-09-01']);
    });

    it('GET /transactions breaks a date tie by createdAt DESC, stable across repeated calls (edge-probe: adjacency)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Adjacencia', type: 'corrente', balance: '0.00' });
      const adjacencyAccountId = (account.body as EnvelopeBody<AccountData>)
        .data?.id as string;

      const first = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '1.00',
          accountId: adjacencyAccountId,
          categoryId,
          description: 'Primeiro',
          date: '2026-09-13',
        })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '1.00',
          accountId: adjacencyAccountId,
          categoryId,
          description: 'Segundo',
          date: '2026-09-13',
        })
        .expect(201);
      const firstId = (first.body as EnvelopeBody<TransactionData>).data?.id;
      const secondId = (second.body as EnvelopeBody<TransactionData>).data?.id;

      const call1 = await request(app.getHttpServer())
        .get('/transactions')
        .set('Authorization', `Bearer ${accessToken}`);
      const call2 = await request(app.getHttpServer())
        .get('/transactions')
        .set('Authorization', `Bearer ${accessToken}`);

      const idsForAccount = (body: EnvelopeBody<TransactionData[]>) =>
        (body.data ?? [])
          .filter((t) => t.accountId === adjacencyAccountId)
          .map((t) => t.id);

      const ids1 = idsForAccount(call1.body as EnvelopeBody<TransactionData[]>);
      const ids2 = idsForAccount(call2.body as EnvelopeBody<TransactionData[]>);

      expect(ids1).toEqual([secondId, firstId]);
      expect(ids2).toEqual(ids1);
    });

    it('PATCH /transactions/:id rejects amount/accountId/categoryId with 400, but a description-only PATCH succeeds and leaves locked fields unchanged (D-04)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Patch', type: 'corrente', balance: '1000.00' });
      const patchAccountId = (account.body as EnvelopeBody<AccountData>).data
        ?.id as string;

      const created = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '20.00',
          accountId: patchAccountId,
          categoryId,
          description: 'Original',
          date: '2026-09-13',
        })
        .expect(201);
      const transactionId = (created.body as EnvelopeBody<TransactionData>).data
        ?.id as string;

      const amountAttempt = await request(app.getHttpServer())
        .patch(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ amount: '999.00' });
      expect(amountAttempt.status).toBe(400);

      const accountAttempt = await request(app.getHttpServer())
        .patch(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ accountId: categoryId });
      expect(accountAttempt.status).toBe(400);

      const categoryAttempt = await request(app.getHttpServer())
        .patch(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: patchAccountId });
      expect(categoryAttempt.status).toBe(400);

      const descriptionOnly = await request(app.getHttpServer())
        .patch(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ description: 'Novo texto' });
      expect(descriptionOnly.status).toBe(200);

      const afterPatch = await request(app.getHttpServer())
        .get(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      const afterPatchData = (afterPatch.body as EnvelopeBody<TransactionData>)
        .data;
      expect(afterPatchData?.description).toBe('Novo texto');
      expect(afterPatchData?.amount).toBe('20.00');
      expect(afterPatchData?.accountId).toBe(patchAccountId);
      expect(afterPatchData?.categoryId).toBe(categoryId);
    });

    it('PATCH /transactions/:id with an empty body returns 200 with the transaction unchanged, not a 500 (regression, CR-01)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Patch Vazio',
          type: 'corrente',
          balance: '1000.00',
        });
      const emptyPatchAccountId = (account.body as EnvelopeBody<AccountData>)
        .data?.id as string;

      const created = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '20.00',
          accountId: emptyPatchAccountId,
          categoryId,
          description: 'Original',
          date: '2026-09-13',
        })
        .expect(201);
      const transactionId = (created.body as EnvelopeBody<TransactionData>).data
        ?.id as string;

      const emptyPatch = await request(app.getHttpServer())
        .patch(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});
      expect(emptyPatch.status).toBe(200);

      const afterPatch = await request(app.getHttpServer())
        .get(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      const afterPatchData = (afterPatch.body as EnvelopeBody<TransactionData>)
        .data;
      expect(afterPatchData?.description).toBe('Original');
      expect(afterPatchData?.date).toBe('2026-09-13');
    });

    it('PATCH /transactions/:id with {"date": null} or {"description": null} returns 400, not a 500 (regression, CR-01)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Patch Null',
          type: 'corrente',
          balance: '1000.00',
        });
      const nullPatchAccountId = (account.body as EnvelopeBody<AccountData>)
        .data?.id as string;

      const created = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '20.00',
          accountId: nullPatchAccountId,
          categoryId,
          description: 'Original',
          date: '2026-09-13',
        })
        .expect(201);
      const transactionId = (created.body as EnvelopeBody<TransactionData>).data
        ?.id as string;

      const nullDate = await request(app.getHttpServer())
        .patch(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ date: null });
      expect(nullDate.status).toBe(400);

      const nullDescription = await request(app.getHttpServer())
        .patch(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ description: null });
      expect(nullDescription.status).toBe(400);

      const afterPatch = await request(app.getHttpServer())
        .get(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      const afterPatchData = (afterPatch.body as EnvelopeBody<TransactionData>)
        .data;
      expect(afterPatchData?.description).toBe('Original');
      expect(afterPatchData?.date).toBe('2026-09-13');
    });

    it('DELETE /transactions/:id reverses the exact balance effect for an expense and for an income (D-06)', async () => {
      const expenseAccount = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Reversao Despesa',
          type: 'corrente',
          balance: '1000.00',
        });
      const expenseAccountId = (
        expenseAccount.body as EnvelopeBody<AccountData>
      ).data?.id as string;
      const expenseTransaction = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '50.00',
          accountId: expenseAccountId,
          categoryId,
          description: 'Despesa a reverter',
          date: '2026-09-13',
        })
        .expect(201);
      const expenseTransactionId = (
        expenseTransaction.body as EnvelopeBody<TransactionData>
      ).data?.id as string;

      const expenseDelete = await request(app.getHttpServer())
        .delete(`/transactions/${expenseTransactionId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(expenseDelete.status).toBe(200);

      const expenseAccountAfter = await request(app.getHttpServer())
        .get(`/accounts/${expenseAccountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(
        (expenseAccountAfter.body as EnvelopeBody<AccountData>).data?.balance,
      ).toBe('1000.00');

      const incomeAccount = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Reversao Receita',
          type: 'corrente',
          balance: '1000.00',
        });
      const incomeAccountId = (incomeAccount.body as EnvelopeBody<AccountData>)
        .data?.id as string;
      const incomeTransaction = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'income',
          amount: '75.00',
          accountId: incomeAccountId,
          categoryId,
          description: 'Receita a reverter',
          date: '2026-09-13',
        })
        .expect(201);
      const incomeTransactionId = (
        incomeTransaction.body as EnvelopeBody<TransactionData>
      ).data?.id as string;

      const incomeDelete = await request(app.getHttpServer())
        .delete(`/transactions/${incomeTransactionId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(incomeDelete.status).toBe(200);

      const incomeAccountAfter = await request(app.getHttpServer())
        .get(`/accounts/${incomeAccountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(
        (incomeAccountAfter.body as EnvelopeBody<AccountData>).data?.balance,
      ).toBe('1000.00');
    });

    it('a second DELETE on an already-deleted transaction id returns 404 and never double-reverses the balance (edge-probe: idempotency)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Delete Duplo',
          type: 'corrente',
          balance: '1000.00',
        });
      const idempotentAccountId = (account.body as EnvelopeBody<AccountData>)
        .data?.id as string;
      const created = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '40.00',
          accountId: idempotentAccountId,
          categoryId,
          description: 'Delete duplo',
          date: '2026-09-13',
        })
        .expect(201);
      const transactionId = (created.body as EnvelopeBody<TransactionData>).data
        ?.id as string;

      const firstDelete = await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(firstDelete.status).toBe(200);

      const balanceAfterFirst = (
        (
          await request(app.getHttpServer())
            .get(`/accounts/${idempotentAccountId}`)
            .set('Authorization', `Bearer ${accessToken}`)
        ).body as EnvelopeBody<AccountData>
      ).data?.balance;
      // Delete reverses the expense's balance effect immediately (D-06) —
      // the account balance goes back to its pre-transaction value (1000.00),
      // not the post-transaction value (960.00).
      expect(balanceAfterFirst).toBe('1000.00');

      const secondDelete = await request(app.getHttpServer())
        .delete(`/transactions/${transactionId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(secondDelete.status).toBe(404);

      const balanceAfterSecond = (
        (
          await request(app.getHttpServer())
            .get(`/accounts/${idempotentAccountId}`)
            .set('Authorization', `Bearer ${accessToken}`)
        ).body as EnvelopeBody<AccountData>
      ).data?.balance;
      // Unchanged between first and second delete attempts — the second
      // (404) never double-reverses.
      expect(balanceAfterSecond).toBe(balanceAfterFirst);
    });

    it('a malformed :id on GET/PATCH/DELETE returns 400, not a raw 500', async () => {
      const malformedId = 'not-a-uuid';

      const getResponse = await request(app.getHttpServer())
        .get(`/transactions/${malformedId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(getResponse.status).toBe(400);

      const patchResponse = await request(app.getHttpServer())
        .patch(`/transactions/${malformedId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ description: 'nova descricao' });
      expect(patchResponse.status).toBe(400);

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/transactions/${malformedId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(deleteResponse.status).toBe(400);
    });

    it('two concurrent DELETEs on the same transaction id never double-reverse the balance — exactly one 200, one 404 (edge-probe: concurrency, Pitfall 2)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Delete Concorrente',
          type: 'corrente',
          balance: '1000.00',
        });
      const concurrentAccountId = (account.body as EnvelopeBody<AccountData>)
        .data?.id as string;
      const created = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '30.00',
          accountId: concurrentAccountId,
          categoryId,
          description: 'Delete concorrente',
          date: '2026-09-13',
        })
        .expect(201);
      const transactionId = (created.body as EnvelopeBody<TransactionData>).data
        ?.id as string;

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .delete(`/transactions/${transactionId}`)
          .set('Authorization', `Bearer ${accessToken}`),
        request(app.getHttpServer())
          .delete(`/transactions/${transactionId}`)
          .set('Authorization', `Bearer ${accessToken}`),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 404]);

      const accountAfter = await request(app.getHttpServer())
        .get(`/accounts/${concurrentAccountId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      // The balance is reversed EXACTLY ONCE — back to the pre-transaction
      // value (1000.00), never twice (which would overshoot to 1030.00) and
      // never zero times (which would leave it at 970.00).
      expect(
        (accountAfter.body as EnvelopeBody<AccountData>).data?.balance,
      ).toBe('1000.00');
    });

    // Transfer-id exclusion (this plan's key architectural decision): a
    // transfer created via a raw repository-adjacent path is not available
    // yet — POST /transfers ships in 04-03-PLAN.md. This case is
    // deliberately skipped here and will be covered by 04-03-PLAN.md's own
    // cross-tenant/e2e task once /transfers exists (documented deviation,
    // not an oversight — see this plan's action text).
  });
});
