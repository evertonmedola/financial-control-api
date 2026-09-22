import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same ThrottlerGuard no-op override as accounts.e2e-spec.ts/
// categories.e2e-spec.ts/transactions.e2e-spec.ts.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface BudgetData {
  id?: string;
  categoryId?: string;
  limit?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface BudgetStatusData {
  categoryId?: string;
  limit?: string;
  spent?: string;
  remaining?: string;
  overBudget?: boolean;
}

interface AccountData {
  id?: string;
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

// Today's date, formatted as an ISO date string ("YYYY-MM-DD") — used for
// transaction/transfer dates so this suite always exercises "the current
// calendar month" regardless of when it's run.
const todayIso = (): string => new Date().toISOString().slice(0, 10);

// The 1st of the current calendar month — used by the D-05 mid-month test.
const firstOfCurrentMonthIso = (): string => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
};

describe('Budgets (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  const uniqueEmail = () =>
    `budgets-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

  describe('create budget', () => {
    it('POST /budgets sets a limit, GET /budgets shows zero-spend status, then reflects a real expense while excluding a transfer (tracer)', async () => {
      const contaA = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta A', type: 'corrente', balance: '1000.00' });
      const contaAId = (contaA.body as EnvelopeBody<AccountData>).data
        ?.id as string;

      const contaB = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta B', type: 'corrente', balance: '500.00' });
      const contaBId = (contaB.body as EnvelopeBody<AccountData>).data
        ?.id as string;

      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Alimentação', type: 'despesa' });
      const categoryId = (category.body as EnvelopeBody<CategoryData>).data
        ?.id as string;

      const createBudget = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: '300.00' });
      expect(createBudget.status).toBe(201);
      const createdBudget = (createBudget.body as EnvelopeBody<BudgetData>)
        .data;
      expect(createdBudget?.categoryId).toBe(categoryId);
      expect(createdBudget?.limit).toBe('300.00');

      const listZero = await request(app.getHttpServer())
        .get('/budgets')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(listZero.status).toBe(200);
      const zeroEntry = (
        (listZero.body as EnvelopeBody<BudgetStatusData[]>).data ?? []
      ).find((entry) => entry.categoryId === categoryId);
      expect(zeroEntry?.spent).toBe('0.00');
      expect(zeroEntry?.remaining).toBe('300.00');
      expect(zeroEntry?.overBudget).toBe(false);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '50.00',
          accountId: contaAId,
          categoryId,
          description: 'Mercado',
          date: todayIso(),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transfers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          fromAccountId: contaAId,
          toAccountId: contaBId,
          amount: '100.00',
          date: todayIso(),
          description: 'Transferência',
        })
        .expect(201);

      const listAfter = await request(app.getHttpServer())
        .get('/budgets')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(listAfter.status).toBe(200);
      const entryAfter = (
        (listAfter.body as EnvelopeBody<BudgetStatusData[]>).data ?? []
      ).find((entry) => entry.categoryId === categoryId);
      expect(entryAfter?.spent).toBe('50.00');
      expect(entryAfter?.remaining).toBe('250.00');
      expect(entryAfter?.overBudget).toBe(false);
    });
  });

  describe('view/edit/delete budget', () => {
    it('rejects a budget for a RECEITA category with 400 (D-03)', async () => {
      const receitaCategory = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Salário VW', type: 'receita' });
      const receitaCategoryId = (
        receitaCategory.body as EnvelopeBody<CategoryData>
      ).data?.id as string;

      const response = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: receitaCategoryId, limit: '100.00' });

      expect(response.status).toBe(400);
    });

    it('a second POST /budgets for the same categoryId returns 409, and two concurrent POSTs resolve to exactly one 201 and one 409 (D-07 unique index)', async () => {
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Transporte VW', type: 'despesa' });
      const categoryId = (category.body as EnvelopeBody<CategoryData>).data
        ?.id as string;

      const first = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: '200.00' });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: '200.00' });
      expect(second.status).toBe(409);

      const concurrencyCategory = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Concorrencia VW', type: 'despesa' });
      const concurrencyCategoryId = (
        concurrencyCategory.body as EnvelopeBody<CategoryData>
      ).data?.id as string;
      const body = { categoryId: concurrencyCategoryId, limit: '150.00' };

      const [concurrentFirst, concurrentSecond] = await Promise.all([
        request(app.getHttpServer())
          .post('/budgets')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(body),
        request(app.getHttpServer())
          .post('/budgets')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(body),
      ]);
      const statuses = [concurrentFirst.status, concurrentSecond.status].sort(
        (a, b) => a - b,
      );
      expect(statuses).toEqual([201, 409]);
    });

    it('an over-budget category shows overBudget: true and a negative, un-clamped remaining (BUD-03, D-08)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Overbudget',
          type: 'corrente',
          balance: '1000.00',
        });
      const accountId = (account.body as EnvelopeBody<AccountData>).data
        ?.id as string;

      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Lazer Overbudget', type: 'despesa' });
      const categoryId = (category.body as EnvelopeBody<CategoryData>).data
        ?.id as string;

      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: '100.00' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '150.00',
          accountId,
          categoryId,
          description: 'Gasto excessivo',
          date: todayIso(),
        })
        .expect(201);

      const list = await request(app.getHttpServer())
        .get('/budgets')
        .set('Authorization', `Bearer ${accessToken}`);
      const entry = (
        (list.body as EnvelopeBody<BudgetStatusData[]>).data ?? []
      ).find((item) => item.categoryId === categoryId);
      expect(entry?.spent).toBe('150.00');
      expect(entry?.remaining).toBe('-50.00');
      expect(entry?.overBudget).toBe(true);
    });

    it('a budget created after an earlier-in-the-month transaction still reflects that transaction in spent (D-05, mid-month creation)', async () => {
      const account = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Mid-Month',
          type: 'corrente',
          balance: '1000.00',
        });
      const accountId = (account.body as EnvelopeBody<AccountData>).data
        ?.id as string;

      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Farmacia Mid-Month', type: 'despesa' });
      const categoryId = (category.body as EnvelopeBody<CategoryData>).data
        ?.id as string;

      await request(app.getHttpServer())
        .post('/transactions')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          type: 'expense',
          amount: '30.00',
          accountId,
          categoryId,
          description: 'Gasto no inicio do mes',
          date: firstOfCurrentMonthIso(),
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: '200.00' })
        .expect(201);

      const list = await request(app.getHttpServer())
        .get('/budgets')
        .set('Authorization', `Bearer ${accessToken}`);
      const entry = (
        (list.body as EnvelopeBody<BudgetStatusData[]>).data ?? []
      ).find((item) => item.categoryId === categoryId);
      expect(entry?.spent).toBe('30.00');
    });

    it('PATCH /budgets/:id updates limit, reflected in a subsequent GET /budgets remaining computation (D-02)', async () => {
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Educacao Patch', type: 'despesa' });
      const categoryId = (category.body as EnvelopeBody<CategoryData>).data
        ?.id as string;

      const created = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: '200.00' });
      const budgetId = (created.body as EnvelopeBody<BudgetData>).data
        ?.id as string;

      const patched = await request(app.getHttpServer())
        .patch(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ limit: '400.00' });
      expect(patched.status).toBe(200);
      expect((patched.body as EnvelopeBody<BudgetData>).data?.limit).toBe(
        '400.00',
      );

      const list = await request(app.getHttpServer())
        .get('/budgets')
        .set('Authorization', `Bearer ${accessToken}`);
      const entry = (
        (list.body as EnvelopeBody<BudgetStatusData[]>).data ?? []
      ).find((item) => item.categoryId === categoryId);
      expect(entry?.limit).toBe('400.00');
      expect(entry?.remaining).toBe('400.00');
    });

    it('PATCH /budgets/:id rejects a body containing categoryId with 400, and the budget category is unchanged', async () => {
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Categoria Travada', type: 'despesa' });
      const categoryId = (category.body as EnvelopeBody<CategoryData>).data
        ?.id as string;

      const otherCategory = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Outra Categoria', type: 'despesa' });
      const otherCategoryId = (otherCategory.body as EnvelopeBody<CategoryData>)
        .data?.id as string;

      const created = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: '150.00' });
      const budgetId = (created.body as EnvelopeBody<BudgetData>).data
        ?.id as string;

      const patched = await request(app.getHttpServer())
        .patch(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId: otherCategoryId });
      expect(patched.status).toBe(400);

      const getResponse = await request(app.getHttpServer())
        .get(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(
        (getResponse.body as EnvelopeBody<BudgetData>).data?.categoryId,
      ).toBe(categoryId);
    });

    it('PATCH /budgets/:id with an empty body returns 200 with the budget unchanged, not a 500 (regression, CR-01)', async () => {
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Categoria Patch Vazio', type: 'despesa' });
      const categoryId = (category.body as EnvelopeBody<CategoryData>).data
        ?.id as string;

      const created = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: '250.00' });
      const budgetId = (created.body as EnvelopeBody<BudgetData>).data
        ?.id as string;

      const patched = await request(app.getHttpServer())
        .patch(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});
      expect(patched.status).toBe(200);
      expect((patched.body as EnvelopeBody<BudgetData>).data?.limit).toBe(
        '250.00',
      );
    });

    it('DELETE /budgets/:id soft-deletes, 404s afterward, disappears from the list, is idempotent, and frees the category for reuse (D-07)', async () => {
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Categoria Delete', type: 'despesa' });
      const categoryId = (category.body as EnvelopeBody<CategoryData>).data
        ?.id as string;

      const created = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: '100.00' });
      const budgetId = (created.body as EnvelopeBody<BudgetData>).data
        ?.id as string;

      const firstDelete = await request(app.getHttpServer())
        .delete(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(firstDelete.status).toBe(200);
      expect(firstDelete.body as EnvelopeBody<Record<string, never>>).toEqual(
        expect.objectContaining({ data: {} }),
      );

      const getAfterDelete = await request(app.getHttpServer())
        .get(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(getAfterDelete.status).toBe(404);

      const list = await request(app.getHttpServer())
        .get('/budgets')
        .set('Authorization', `Bearer ${accessToken}`);
      const ids = (
        (list.body as EnvelopeBody<BudgetStatusData[]>).data ?? []
      ).map((item) => item.categoryId);
      expect(ids).not.toContain(categoryId);

      const secondDelete = await request(app.getHttpServer())
        .delete(`/budgets/${budgetId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(secondDelete.status).toBe(404);

      const recreate = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, limit: '100.00' });
      expect(recreate.status).toBe(201);
      const newId = (recreate.body as EnvelopeBody<BudgetData>).data?.id;
      expect(newId).toBeDefined();
      expect(newId).not.toBe(budgetId);
    });

    it('a malformed :id on GET/PATCH/DELETE returns 400, not a raw 500', async () => {
      const malformedId = 'not-a-uuid';

      const getResponse = await request(app.getHttpServer())
        .get(`/budgets/${malformedId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(getResponse.status).toBe(400);

      const patchResponse = await request(app.getHttpServer())
        .patch(`/budgets/${malformedId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ limit: '10.00' });
      expect(patchResponse.status).toBe(400);

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/budgets/${malformedId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(deleteResponse.status).toBe(400);
    });

    it('a syntactically valid but nonexistent categoryId returns 404 on create (Pitfall 3, IDOR ownership-chain)', async () => {
      const response = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          // A syntactically valid (well-formed v4) UUID that is guaranteed
          // not to exist in the categories table.
          categoryId: 'ab2e3980-297d-4a86-bea9-4acb2e4aec4b',
          limit: '100.00',
        });

      expect(response.status).toBe(404);
    });

    it('rejects a client-supplied userId field with 400 instead of honoring it (Pitfall 3 / IDOR)', async () => {
      const category = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Categoria IDOR Budget', type: 'despesa' });
      const categoryId = (category.body as EnvelopeBody<CategoryData>).data
        ?.id as string;

      const response = await request(app.getHttpServer())
        .post('/budgets')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          categoryId,
          limit: '100.00',
          userId: '11111111-1111-1111-1111-111111111111',
        });

      expect(response.status).toBe(400);
    });
  });
});
