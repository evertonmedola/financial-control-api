import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Dedicated two-user isolation regression suite for the Reports module,
// mirroring test/budgets-cross-tenant.e2e-spec.ts's exact structure. Unlike
// Budgets, every Reports route is a plain GET with no :id path param —
// userId is sourced only from @CurrentUser(), never a route parameter — so
// there is no foreign-id-404 case to test here. The entire isolation proof
// is list-scoping and aggregation-scoping: creating another tenant's
// account/category/transaction must never change the caller's own report
// output, even under identically-named categories.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

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
}

interface CategorySummaryData {
  categoryId?: string;
  categoryName?: string;
  total?: string;
}

interface NetBalanceData {
  balance?: string;
}

interface MonthComparisonData {
  categoryId?: string;
  categoryName?: string;
  currentMonthTotal?: string;
  previousMonthTotal?: string;
  delta?: string;
}

// Today's date, formatted as an ISO date string ("YYYY-MM-DD") — mirrors
// test/reports.e2e-spec.ts's helper, never a hardcoded date.
const todayIso = (): string => new Date().toISOString().slice(0, 10);

const currentMonthIso = (): string => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};

const dateInPreviousMonthIso = (): string => {
  const now = new Date();
  const previous = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
  );
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-15`;
};

describe('Reports cross-tenant isolation (e2e)', () => {
  let app: INestApplication;

  const uniqueEmail = (label: string) =>
    `reports-cross-tenant-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

    return { email, id, accessToken };
  };

  const createAccount = async (
    session: Session,
    name: string,
    type: string,
    balance: string,
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name, type, balance })
      .expect(201);
    return (response.body as EnvelopeBody<AccountData>).data?.id as string;
  };

  const createCategory = async (
    session: Session,
    name: string,
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/categories')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name, type: 'despesa' })
      .expect(201);
    return (response.body as EnvelopeBody<CategoryData>).data?.id as string;
  };

  const createExpense = async (
    session: Session,
    accountId: string,
    categoryId: string,
    amount: string,
    date: string,
    description: string,
  ): Promise<void> => {
    await request(app.getHttpServer())
      .post('/transactions')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        type: 'expense',
        amount,
        accountId,
        categoryId,
        description,
        date,
      })
      .expect(201);
  };

  it("GET /reports/category-summary for A never includes B's category/spend, even under an identically-named DESPESA category in the same date range", async () => {
    const userA = await registerAndLogin('cat-a');
    const userB = await registerAndLogin('cat-b');

    const aAccountId = await createAccount(
      userA,
      'Conta A',
      'corrente',
      '1000.00',
    );
    const aCategoryId = await createCategory(userA, 'Mesmo Nome');
    await createExpense(
      userA,
      aAccountId,
      aCategoryId,
      '50.00',
      todayIso(),
      "A's gasto",
    );

    const bAccountId = await createAccount(
      userB,
      'Conta B',
      'corrente',
      '1000.00',
    );
    const bCategoryId = await createCategory(userB, 'Mesmo Nome');
    await createExpense(
      userB,
      bAccountId,
      bCategoryId,
      '999.00',
      todayIso(),
      "B's gasto",
    );

    const response = await request(app.getHttpServer())
      .get(`/reports/category-summary?from=${todayIso()}&to=${todayIso()}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(200);
    const entries =
      (response.body as EnvelopeBody<CategorySummaryData[]>).data ?? [];
    const categoryIds = entries.map((entry) => entry.categoryId);

    expect(categoryIds).toContain(aCategoryId);
    expect(categoryIds).not.toContain(bCategoryId);

    const aEntry = entries.find((entry) => entry.categoryId === aCategoryId);
    expect(aEntry?.total).toBe('50.00');
  });

  it("GET /reports/net-balance for A is unaffected by B creating an account — A's net balance stays exactly the same before and after", async () => {
    const userA = await registerAndLogin('bal-a');
    const userB = await registerAndLogin('bal-b');

    await createAccount(userA, 'Conta A', 'corrente', '1000.00');

    const beforeResponse = await request(app.getHttpServer())
      .get('/reports/net-balance')
      .set('Authorization', `Bearer ${userA.accessToken}`);
    expect(beforeResponse.status).toBe(200);
    const balanceBefore = (beforeResponse.body as EnvelopeBody<NetBalanceData>)
      .data?.balance;

    await createAccount(userB, 'Conta Grande B', 'corrente', '999999.99');

    const afterResponse = await request(app.getHttpServer())
      .get('/reports/net-balance')
      .set('Authorization', `Bearer ${userA.accessToken}`);
    expect(afterResponse.status).toBe(200);
    const balanceAfter = (afterResponse.body as EnvelopeBody<NetBalanceData>)
      .data?.balance;

    expect(balanceAfter).toBe(balanceBefore);
    expect(balanceAfter).toBe('1000.00');
  });

  it("GET /reports/month-comparison for A never includes B's category activity, even under an identically-named category in both the current and previous month", async () => {
    const userA = await registerAndLogin('mc-a');
    const userB = await registerAndLogin('mc-b');

    const aAccountId = await createAccount(
      userA,
      'Conta A',
      'corrente',
      '1000.00',
    );
    const aCategoryId = await createCategory(userA, 'Categoria Comparação');
    await createExpense(
      userA,
      aAccountId,
      aCategoryId,
      '40.00',
      todayIso(),
      "A's gasto mês atual",
    );
    await createExpense(
      userA,
      aAccountId,
      aCategoryId,
      '25.00',
      dateInPreviousMonthIso(),
      "A's gasto mês anterior",
    );

    const bAccountId = await createAccount(
      userB,
      'Conta B',
      'corrente',
      '1000.00',
    );
    const bCategoryId = await createCategory(userB, 'Categoria Comparação');
    await createExpense(
      userB,
      bAccountId,
      bCategoryId,
      '400.00',
      todayIso(),
      "B's gasto mês atual",
    );
    await createExpense(
      userB,
      bAccountId,
      bCategoryId,
      '250.00',
      dateInPreviousMonthIso(),
      "B's gasto mês anterior",
    );

    const response = await request(app.getHttpServer())
      .get(`/reports/month-comparison?month=${currentMonthIso()}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(200);
    const entries =
      (response.body as EnvelopeBody<MonthComparisonData[]>).data ?? [];
    const categoryIds = entries.map((entry) => entry.categoryId);

    expect(categoryIds).toContain(aCategoryId);
    expect(categoryIds).not.toContain(bCategoryId);

    const aEntry = entries.find((entry) => entry.categoryId === aCategoryId);
    expect(aEntry?.currentMonthTotal).toBe('40.00');
    expect(aEntry?.previousMonthTotal).toBe('25.00');
    expect(aEntry?.delta).toBe('15.00');
  });
});
