import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same ThrottlerGuard no-op override as transactions.e2e-spec.ts.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface TransferData {
  id?: string;
  amount?: string;
  fromAccountId?: string;
  toAccountId?: string;
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

interface TransactionData {
  id?: string;
  categoryId?: string | null;
}

interface AuthData {
  accessToken?: string;
  refreshToken?: string;
}

interface EnvelopeBody<T> {
  data?: T;
  timestamp?: string;
}

describe('Transfers (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let accountA: string;
  let accountB: string;

  const uniqueEmail = () =>
    `transfers-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'super-secret-password';

  const createAccount = async (balance: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: `Conta ${Math.random()}`, type: 'corrente', balance })
      .expect(201);
    return (response.body as EnvelopeBody<AccountData>).data?.id as string;
  };

  const getBalance = async (id: string): Promise<string | undefined> => {
    const response = await request(app.getHttpServer())
      .get(`/accounts/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    return (response.body as EnvelopeBody<AccountData>).data?.balance;
  };

  const createTransfer = async (
    fromAccountId: string,
    toAccountId: string,
    amount: string,
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        fromAccountId,
        toAccountId,
        amount,
        date: '2026-09-13',
        description: 'Transferência de teste',
      })
      .expect(201);
    return (response.body as EnvelopeBody<TransferData>).data?.id as string;
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

  beforeEach(async () => {
    accountA = await createAccount('1000.00');
    accountB = await createAccount('500.00');
  });

  describe('create transfer', () => {
    it('POST /transfers moves money between two of the caller own accounts atomically, both balances updating in the same request', async () => {
      const response = await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromAccountId: accountA,
          toAccountId: accountB,
          amount: '200.00',
          date: '2026-09-13',
          description: 'Transferência',
        });

      expect(response.status).toBe(201);
      const body = (response.body as EnvelopeBody<TransferData>).data;
      expect(body?.id).toBeDefined();
      expect(body?.fromAccountId).toBe(accountA);
      expect(body?.toAccountId).toBe(accountB);
      expect(body?.amount).toBe('200.00');

      expect(await getBalance(accountA)).toBe('800.00');
      expect(await getBalance(accountB)).toBe('700.00');
    });

    it('rejects fromAccountId === toAccountId with 400 (self-transfer)', async () => {
      const response = await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromAccountId: accountA,
          toAccountId: accountA,
          amount: '10.00',
          date: '2026-09-13',
          description: 'Self transfer',
        });

      expect(response.status).toBe(400);
    });

    it('rejects amount "0.00" with 400 (edge-probe: boundary)', async () => {
      const response = await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromAccountId: accountA,
          toAccountId: accountB,
          amount: '0.00',
          date: '2026-09-13',
          description: 'Zero',
        });

      expect(response.status).toBe(400);
    });

    it('rejects a negative amount with 400 (structurally, per the regex; edge-probe: boundary)', async () => {
      const response = await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromAccountId: accountA,
          toAccountId: accountB,
          amount: '-50.00',
          date: '2026-09-13',
          description: 'Negativo',
        });

      expect(response.status).toBe(400);
    });

    it('rejects an amount whose integer part overflows numeric(12,2) with 400 (edge-probe: boundary)', async () => {
      const response = await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromAccountId: accountA,
          toAccountId: accountB,
          amount: '12345678901.00',
          date: '2026-09-13',
          description: 'Overflow',
        });

      expect(response.status).toBe(400);
    });

    it('rejects a toAccountId belonging to another user with 404 (Pitfall 3, IDOR)', async () => {
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

      const response = await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromAccountId: accountA,
          toAccountId: otherAccountId,
          amount: '10.00',
          date: '2026-09-13',
          description: 'IDOR toAccountId',
        });

      expect(response.status).toBe(404);
    });

    it('rejects a fromAccountId belonging to another user with 404 (Pitfall 3, IDOR — symmetric)', async () => {
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

      const response = await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromAccountId: otherAccountId,
          toAccountId: accountA,
          amount: '10.00',
          date: '2026-09-13',
          description: 'IDOR fromAccountId',
        });

      expect(response.status).toBe(404);
    });

    it('two identical POSTs create two distinct transfer rows — not idempotent by design (edge-probe: idempotency)', async () => {
      const body = {
        fromAccountId: accountA,
        toAccountId: accountB,
        amount: '50.00',
        date: '2026-09-13',
        description: 'Repetido',
      };

      const first = await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);
      const second = await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (first.body as EnvelopeBody<TransferData>).data?.id;
      const secondId = (second.body as EnvelopeBody<TransferData>).data?.id;
      expect(firstId).not.toBe(secondId);

      expect(await getBalance(accountA)).toBe('900.00');
      expect(await getBalance(accountB)).toBe('600.00');
    });

    it('PATCH /transfers/:id returns 404 (D-05 — no PATCH route exists on this controller)', async () => {
      const created = await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromAccountId: accountA,
          toAccountId: accountB,
          amount: '10.00',
          date: '2026-09-13',
          description: 'Para tentar PATCH',
        })
        .expect(201);
      const transferId = (created.body as EnvelopeBody<TransferData>).data
        ?.id as string;

      const response = await request(app.getHttpServer())
        .patch(`/transfers/${transferId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ description: 'tentativa' });

      expect(response.status).toBe(404);
    });
  });

  describe('delete transfer', () => {
    it('DELETE /transfers/:id reverses both account balances to their exact pre-transfer values (D-06)', async () => {
      const transferId = await createTransfer(accountA, accountB, '150.00');

      const response = await request(app.getHttpServer())
        .delete(`/transfers/${transferId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(response.status).toBe(200);

      expect(await getBalance(accountA)).toBe('1000.00');
      expect(await getBalance(accountB)).toBe('500.00');
    });

    it('a malformed :id on DELETE returns 400, not a raw 500', async () => {
      const deleteResponse = await request(app.getHttpServer())
        .delete('/transfers/not-a-uuid')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(deleteResponse.status).toBe(400);
    });

    it('a second DELETE on an already-deleted transfer id returns 404, and neither balance changes between attempts (edge-probe: idempotency)', async () => {
      const transferId = await createTransfer(accountA, accountB, '150.00');

      const firstDelete = await request(app.getHttpServer())
        .delete(`/transfers/${transferId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(firstDelete.status).toBe(200);

      const balanceAAfterFirst = await getBalance(accountA);
      const balanceBAfterFirst = await getBalance(accountB);
      expect(balanceAAfterFirst).toBe('1000.00');
      expect(balanceBAfterFirst).toBe('500.00');

      const secondDelete = await request(app.getHttpServer())
        .delete(`/transfers/${transferId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(secondDelete.status).toBe(404);

      expect(await getBalance(accountA)).toBe(balanceAAfterFirst);
      expect(await getBalance(accountB)).toBe(balanceBAfterFirst);
    });

    it('two concurrent DELETEs on the same transfer id never double-reverse — exactly one 200, one 404, reversal happens EXACTLY ONCE (edge-probe: concurrency)', async () => {
      const transferId = await createTransfer(accountA, accountB, '150.00');

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .delete(`/transfers/${transferId}`)
          .set('Authorization', `Bearer ${accessToken}`),
        request(app.getHttpServer())
          .delete(`/transfers/${transferId}`)
          .set('Authorization', `Bearer ${accessToken}`),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 404]);

      // Reversed EXACTLY ONCE — never twice, never zero times.
      expect(await getBalance(accountA)).toBe('1000.00');
      expect(await getBalance(accountB)).toBe('500.00');
    });

    it('two concurrent opposite-direction transfers between the same account pair never deadlock and never lose an update (Pitfall 2, edge-probe: concurrency)', async () => {
      const [aToB, bToA] = await Promise.all([
        request(app.getHttpServer())
          .post('/transfers')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            fromAccountId: accountA,
            toAccountId: accountB,
            amount: '100.00',
            date: '2026-09-13',
            description: 'A para B',
          }),
        request(app.getHttpServer())
          .post('/transfers')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            fromAccountId: accountB,
            toAccountId: accountA,
            amount: '50.00',
            date: '2026-09-13',
            description: 'B para A',
          }),
      ]);

      expect(aToB.status).toBe(201);
      expect(bToA.status).toBe(201);

      // accountA: 1000 - 100 + 50 = 950.00; accountB: 500 + 100 - 50 = 550.00.
      expect(await getBalance(accountA)).toBe('950.00');
      expect(await getBalance(accountB)).toBe('550.00');
    });

    it("a transfer's categoryId is always null — structurally excluded from any category-scoped spend total (TXN-04, D-03)", async () => {
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Alimentação Transfer Test', type: 'despesa' })
        .expect(201);
      const categoryId = (category.body as EnvelopeBody<CategoryData>).data
        ?.id as string;

      const expense = await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '300.00',
          accountId: accountA,
          categoryId,
          description: 'Despesa categorizada',
          date: '2026-09-13',
        })
        .expect(201);
      const expenseId = (expense.body as EnvelopeBody<TransactionData>).data
        ?.id as string;

      const transferId = await createTransfer(accountA, accountB, '999.00');

      const list = await request(app.getHttpServer())
        .get('/transactions')
        .set('Authorization', `Bearer ${accessToken}`);
      const rows = (list.body as EnvelopeBody<TransactionData[]>).data ?? [];

      const transferRow = rows.find((row) => row.id === transferId);
      const expenseRow = rows.find((row) => row.id === expenseId);

      // A category-scoped spend query can only ever be
      // `WHERE category_id = X` — a null categoryId on the transfer row
      // makes it mathematically impossible for it to be summed into that
      // category's total, while the expense row is correctly attributed.
      expect(transferRow?.categoryId).toBeNull();
      expect(expenseRow?.categoryId).toBe(categoryId);
    });
  });
});
