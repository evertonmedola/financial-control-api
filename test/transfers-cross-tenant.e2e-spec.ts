import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Dedicated two-user IDOR/cross-tenant regression suite for the Transfers
// module, mirroring test/transactions-cross-tenant.e2e-spec.ts's structure.
// Proves every create/delete attempt against another tenant's account or
// transfer id returns 404 (never 403, never 200/201).
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface TransferData {
  id?: string;
  fromAccountId?: string;
  toAccountId?: string;
}

interface AccountData {
  id?: string;
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
  accountX: string;
  accountY: string;
}

describe('Transfers cross-tenant isolation (e2e)', () => {
  let app: INestApplication;

  const uniqueEmail = (label: string) =>
    `transfers-cross-tenant-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

    const accountXResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: `Conta X ${label}`, type: 'corrente', balance: '1000.00' })
      .expect(201);
    const accountX = (accountXResponse.body as EnvelopeBody<AccountData>).data
      ?.id as string;

    const accountYResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: `Conta Y ${label}`, type: 'corrente', balance: '500.00' })
      .expect(201);
    const accountY = (accountYResponse.body as EnvelopeBody<AccountData>).data
      ?.id as string;

    return { email, id, accessToken, accountX, accountY };
  };

  const createTransfer = async (session: Session): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        fromAccountId: session.accountX,
        toAccountId: session.accountY,
        amount: '100.00',
        date: '2026-09-13',
        description: 'Transferência de B',
      })
      .expect(201);
    return (response.body as EnvelopeBody<TransferData>).data?.id as string;
  };

  it("POST /transfers as A with toAccountId set to one of B's accounts returns 404", async () => {
    const userA = await registerAndLogin('create-to-a');
    const userB = await registerAndLogin('create-to-b');

    const response = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({
        fromAccountId: userA.accountX,
        toAccountId: userB.accountX,
        amount: '10.00',
        date: '2026-09-13',
        description: 'IDOR toAccountId',
      });

    expect(response.status).toBe(404);
  });

  it("POST /transfers as A with fromAccountId set to one of B's accounts returns 404 (symmetric)", async () => {
    const userA = await registerAndLogin('create-from-a');
    const userB = await registerAndLogin('create-from-b');

    const response = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({
        fromAccountId: userB.accountX,
        toAccountId: userA.accountX,
        amount: '10.00',
        date: '2026-09-13',
        description: 'IDOR fromAccountId',
      });

    expect(response.status).toBe(404);
  });

  it("DELETE /transfers/:id as A using a transfer id B created between B's own two accounts returns 404, and B's transfer is still active", async () => {
    const userA = await registerAndLogin('delete-a');
    const userB = await registerAndLogin('delete-b');
    const bTransferId = await createTransfer(userB);

    const response = await request(app.getHttpServer())
      .delete(`/transfers/${bTransferId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(response.status).toBe(404);

    // B's transfer was never reversed — confirm via B's own token that both
    // of B's balances still reflect the active transfer.
    const accountXAfter = await request(app.getHttpServer())
      .get(`/accounts/${userB.accountX}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    const accountYAfter = await request(app.getHttpServer())
      .get(`/accounts/${userB.accountY}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(
      (accountXAfter.body as EnvelopeBody<AccountData>).data?.balance,
    ).toBe('900.00');
    expect(
      (accountYAfter.body as EnvelopeBody<AccountData>).data?.balance,
    ).toBe('600.00');
  });
});
