import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Dedicated two-user IDOR/cross-tenant regression suite for the Categories
// module, mirroring test/accounts-cross-tenant.e2e-spec.ts's exact
// structure (Phase 2 Plan 2 precedent). Proves every GET/PATCH/DELETE
// /categories/:id route returns 404 (never 403, never 200) when the id
// belongs to a different tenant, and that GET /categories never leaks
// another tenant's category ids into the caller's list.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

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

describe('Categories cross-tenant isolation (e2e)', () => {
  let app: INestApplication;

  const uniqueEmail = (label: string) =>
    `categories-cross-tenant-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

  it("GET /categories/:id with B's category id and A's token returns 404, never 403/200", async () => {
    const userA = await registerAndLogin('get-a');
    const userB = await registerAndLogin('get-b');
    const bCategoryId = await createCategory(userB, "B's category");

    const response = await request(app.getHttpServer())
      .get(`/categories/${bCategoryId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(404);
  });

  it("PATCH /categories/:id with B's category id and A's token returns 404, never 403/200 — and B's category is untouched", async () => {
    const userA = await registerAndLogin('patch-a');
    const userB = await registerAndLogin('patch-b');
    const bCategoryId = await createCategory(userB, "B's category");

    const response = await request(app.getHttpServer())
      .patch(`/categories/${bCategoryId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ name: 'Hijacked Name' });

    expect(response.status).toBe(404);

    const stillB = await request(app.getHttpServer())
      .get(`/categories/${bCategoryId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(stillB.status).toBe(200);
    expect((stillB.body as EnvelopeBody<CategoryData>).data?.name).toBe(
      "B's category",
    );
  });

  it("DELETE /categories/:id with B's category id and A's token returns 404, never 403/200 — and B's category is not deleted", async () => {
    const userA = await registerAndLogin('delete-a');
    const userB = await registerAndLogin('delete-b');
    const bCategoryId = await createCategory(userB, "B's category");

    const response = await request(app.getHttpServer())
      .delete(`/categories/${bCategoryId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(404);

    const stillB = await request(app.getHttpServer())
      .get(`/categories/${bCategoryId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(stillB.status).toBe(200);
  });

  it("GET /categories for A never includes any of B's category ids", async () => {
    const userA = await registerAndLogin('list-a');
    const userB = await registerAndLogin('list-b');
    await createCategory(userA, "A's category 1");
    await createCategory(userA, "A's category 2");
    const bCategoryId1 = await createCategory(userB, "B's category 1");
    const bCategoryId2 = await createCategory(userB, "B's category 2");

    const response = await request(app.getHttpServer())
      .get('/categories')
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(200);
    const ids = (
      (response.body as EnvelopeBody<CategoryData[]>).data ?? []
    ).map((category) => category.id);
    expect(ids).not.toContain(bCategoryId1);
    expect(ids).not.toContain(bCategoryId2);
  });
});
