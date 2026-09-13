import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Dedicated two-user IDOR/cross-tenant regression suite for the Accounts
// module, mirroring test/cross-tenant.e2e-spec.ts's exact structure
// (Phase 1 Plan 5 / Pitfall 3). Proves every GET/PATCH/DELETE /accounts/:id
// route returns 404 (never 403, never 200) when the id belongs to a
// different tenant, and that GET /accounts never leaks another tenant's
// account ids into the caller's list.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface AccountData {
  id?: string;
  name?: string;
  type?: string;
  balance?: string;
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

describe('Accounts cross-tenant isolation (e2e)', () => {
  let app: INestApplication;

  const uniqueEmail = (label: string) =>
    `accounts-cross-tenant-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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
  ): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name, type: 'corrente', balance: '100.00' })
      .expect(201);
    return (response.body as EnvelopeBody<AccountData>).data?.id as string;
  };

  it("GET /accounts/:id with B's account id and A's token returns 404, never 403/200", async () => {
    const userA = await registerAndLogin('get-a');
    const userB = await registerAndLogin('get-b');
    const bAccountId = await createAccount(userB, "B's account");

    const response = await request(app.getHttpServer())
      .get(`/accounts/${bAccountId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(404);
  });

  it("PATCH /accounts/:id with B's account id and A's token returns 404, never 403/200 — and B's account is untouched", async () => {
    const userA = await registerAndLogin('patch-a');
    const userB = await registerAndLogin('patch-b');
    const bAccountId = await createAccount(userB, "B's account");

    const response = await request(app.getHttpServer())
      .patch(`/accounts/${bAccountId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ name: 'Hijacked Name' });

    expect(response.status).toBe(404);

    const stillB = await request(app.getHttpServer())
      .get(`/accounts/${bAccountId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(stillB.status).toBe(200);
    expect((stillB.body as EnvelopeBody<AccountData>).data?.name).toBe(
      "B's account",
    );
  });

  it("DELETE /accounts/:id with B's account id and A's token returns 404, never 403/200 — and B's account is not deleted", async () => {
    const userA = await registerAndLogin('delete-a');
    const userB = await registerAndLogin('delete-b');
    const bAccountId = await createAccount(userB, "B's account");

    const response = await request(app.getHttpServer())
      .delete(`/accounts/${bAccountId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(404);

    const stillB = await request(app.getHttpServer())
      .get(`/accounts/${bAccountId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(stillB.status).toBe(200);
  });

  it("GET /accounts for A never includes any of B's account ids", async () => {
    const userA = await registerAndLogin('list-a');
    const userB = await registerAndLogin('list-b');
    await createAccount(userA, "A's account 1");
    await createAccount(userA, "A's account 2");
    const bAccountId1 = await createAccount(userB, "B's account 1");
    const bAccountId2 = await createAccount(userB, "B's account 2");

    const response = await request(app.getHttpServer())
      .get('/accounts')
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(200);
    const ids = ((response.body as EnvelopeBody<AccountData[]>).data ?? []).map(
      (account) => account.id,
    );
    expect(ids).not.toContain(bAccountId1);
    expect(ids).not.toContain(bAccountId2);
  });
});
