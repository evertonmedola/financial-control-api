import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same ThrottlerGuard no-op override as accounts.e2e-spec.ts/
// categories.e2e-spec.ts/transactions.e2e-spec.ts/budgets.e2e-spec.ts.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

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

interface CategorySummaryData {
  categoryId?: string;
  categoryName?: string;
  total?: string;
}

interface EnvelopeBody<T> {
  data?: T;
  timestamp?: string;
}

// Today's date, formatted as an ISO date string ("YYYY-MM-DD") — used for
// transaction/transfer dates so this suite always exercises "today" as a
// single-day range regardless of when it's run.
const todayIso = (): string => new Date().toISOString().slice(0, 10);

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  const uniqueEmail = () =>
    `reports-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

  describe('category summary', () => {
    it('GET /reports/category-summary sums a real expense while excluding a real transfer (tracer)', async () => {
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

      const response = await request(app.getHttpServer())
        .get(`/reports/category-summary?from=${todayIso()}&to=${todayIso()}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      const entries = (response.body as EnvelopeBody<CategorySummaryData[]>)
        .data as CategorySummaryData[];
      expect(entries).toHaveLength(1);
      expect(entries[0].categoryId).toBe(categoryId);
      expect(entries[0].total).toBe('50.00');
    });
  });
});
