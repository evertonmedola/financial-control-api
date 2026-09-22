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
});
