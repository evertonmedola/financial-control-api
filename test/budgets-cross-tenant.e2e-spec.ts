import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Dedicated two-user IDOR/cross-tenant regression suite for the Budgets
// module, mirroring test/categories-cross-tenant.e2e-spec.ts and
// test/transactions-cross-tenant.e2e-spec.ts's exact structure. Proves every
// GET/PATCH/DELETE /budgets/:id route returns 404 (never 403, never 200)
// when the id belongs to a different tenant, that GET /budgets never leaks
// another tenant's budgets into the caller's list, and that POST /budgets
// with a foreign categoryId returns 404 (never 201) — closing the
// create-time ownership-chain IDOR path, not just read/update/delete.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface BudgetData {
  id?: string;
  categoryId?: string;
  limit?: string;
}

interface BudgetStatusData {
  categoryId?: string;
  limit?: string;
}

interface CategoryData {
  id?: string;
  name?: string;
  type?: string;
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

describe('Budgets cross-tenant isolation (e2e)', () => {
  let app: INestApplication;

  const uniqueEmail = (label: string) =>
    `budgets-cross-tenant-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

  const createBudget = async (
    session: Session,
    categoryId: string,
    limit: string,
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ categoryId, limit })
      .expect(201);
    return (response.body as EnvelopeBody<BudgetData>).data?.id as string;
  };

  it("GET /budgets/:id with B's budget id and A's token returns 404, never 403/200", async () => {
    const userA = await registerAndLogin('get-a');
    const userB = await registerAndLogin('get-b');
    const bCategoryId = await createCategory(userB, "B's category");
    const bBudgetId = await createBudget(userB, bCategoryId, '100.00');

    const response = await request(app.getHttpServer())
      .get(`/budgets/${bBudgetId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(404);
  });

  it("PATCH /budgets/:id with B's budget id and A's token returns 404, never 403/200 — and B's budget limit is unchanged", async () => {
    const userA = await registerAndLogin('patch-a');
    const userB = await registerAndLogin('patch-b');
    const bCategoryId = await createCategory(userB, "B's category");
    const bBudgetId = await createBudget(userB, bCategoryId, '100.00');

    const response = await request(app.getHttpServer())
      .patch(`/budgets/${bBudgetId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ limit: '999.00' });

    expect(response.status).toBe(404);

    const stillB = await request(app.getHttpServer())
      .get(`/budgets/${bBudgetId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(stillB.status).toBe(200);
    expect((stillB.body as EnvelopeBody<BudgetData>).data?.limit).toBe(
      '100.00',
    );
  });

  it("DELETE /budgets/:id with B's budget id and A's token returns 404, never 403/200 — and B's budget is not deleted", async () => {
    const userA = await registerAndLogin('delete-a');
    const userB = await registerAndLogin('delete-b');
    const bCategoryId = await createCategory(userB, "B's category");
    const bBudgetId = await createBudget(userB, bCategoryId, '100.00');

    const response = await request(app.getHttpServer())
      .delete(`/budgets/${bBudgetId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(404);

    const stillB = await request(app.getHttpServer())
      .get(`/budgets/${bBudgetId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(stillB.status).toBe(200);
  });

  it("GET /budgets for A never includes any of B's budgets, even when both users independently budget an identically-named category", async () => {
    const userA = await registerAndLogin('list-a');
    const userB = await registerAndLogin('list-b');

    const aCategoryId = await createCategory(userA, 'Mesmo Nome');
    const aBudgetId = await createBudget(userA, aCategoryId, '100.00');

    const bCategoryId = await createCategory(userB, 'Mesmo Nome');
    const bBudgetId = await createBudget(userB, bCategoryId, '200.00');

    const response = await request(app.getHttpServer())
      .get('/budgets')
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(200);
    const entries =
      (response.body as EnvelopeBody<BudgetStatusData[]>).data ?? [];
    const categoryIds = entries.map((entry) => entry.categoryId);

    expect(categoryIds).toContain(aCategoryId);
    expect(categoryIds).not.toContain(bCategoryId);

    // Sanity: A's returned entry is A's own budget/limit, not B's.
    const aEntry = entries.find((entry) => entry.categoryId === aCategoryId);
    expect(aEntry?.limit).toBe('100.00');

    // Extra confirmation B's budget still exists untouched (never mutated
    // by A's listing call).
    const bStillThere = await request(app.getHttpServer())
      .get(`/budgets/${bBudgetId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(bStillThere.status).toBe(200);
    expect(aBudgetId).not.toBe(bBudgetId);
  });

  it("POST /budgets as A with B's categoryId returns 404, never 201 (create-time ownership-chain check)", async () => {
    const userA = await registerAndLogin('create-a');
    const userB = await registerAndLogin('create-b');
    const bCategoryId = await createCategory(userB, "B's category");

    const response = await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ categoryId: bCategoryId, limit: '100.00' });

    expect(response.status).toBe(404);

    // B's category remains un-budgeted-by-A: B can still create their own
    // budget for it afterward without hitting a stray 409 from A's failed
    // attempt.
    const bBudget = await request(app.getHttpServer())
      .post('/budgets')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .send({ categoryId: bCategoryId, limit: '150.00' });
    expect(bBudget.status).toBe(201);
  });
});
