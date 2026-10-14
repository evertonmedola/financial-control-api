import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same ThrottlerGuard no-op override as auth.e2e-spec.ts/cross-tenant.e2e-spec.ts
// — this suite issues one register+login call per describe block, well
// within the login/register limits individually, but shares a single app
// instance/throttler bucket across the whole file.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface AccountData {
  id?: string;
  name?: string;
  type?: string;
  balance?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AuthData {
  accessToken?: string;
  refreshToken?: string;
}

interface EnvelopeBody<T> {
  data?: T;
  timestamp?: string;
}

describe('Accounts (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  const uniqueEmail = () =>
    `accounts-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

  describe('create account', () => {
    it('POST /accounts creates a corrente account and returns 201 with the created account', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Corrente', type: 'corrente', balance: '1000.00' });

      expect(response.status).toBe(201);
      const body = (response.body as EnvelopeBody<AccountData>).data;
      expect(body?.id).toBeDefined();
      expect(body?.name).toBe('Conta Corrente');
      expect(body?.type).toBe('corrente');
      expect(body?.balance).toBe('1000.00');
      expect(body?.createdAt).toBeDefined();
    });

    it.each([
      ['poupanca', '500.00'],
      ['carteira', '500.00'],
      ['cartao_credito', '500.00'],
      ['cartao_credito', '0.00'],
      ['cartao_credito', '-500.00'],
    ])(
      'POST /accounts creates a %s account and returns the balance %s unchanged (stored like any account; for a card a negative balance is the open debt)',
      async (type, balance) => {
        const response = await request(app.getHttpServer())
          .post('/accounts')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: `Conta ${type}`, type, balance });

        expect(response.status).toBe(201);
        const body = (response.body as EnvelopeBody<AccountData>).data;
        expect(body?.type).toBe(type);
        expect(body?.balance).toBe(balance);
      },
    );

    it('round-trips a decimal balance exactly, never floating-point-altered (Pitfall 1)', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Precisao', type: 'corrente', balance: '1234.56' });

      expect(response.status).toBe(201);
      const body = (response.body as EnvelopeBody<AccountData>).data;
      expect(body?.balance).toBe('1234.56');
      expect(typeof body?.balance).toBe('string');
    });

    it('rejects a balance with more than 2 decimal places with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Invalida', type: 'corrente', balance: '10.999' });

      expect(response.status).toBe(400);
    });

    it('accepts a balance with exactly 2 decimal places with 201', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Valida', type: 'corrente', balance: '10.99' });

      expect(response.status).toBe(201);
    });

    it.each(['0.00', '-100.00'])(
      'accepts a %s balance for a corrente account at creation (CONTEXT.md discretion: accounts can start overdrawn)',
      async (balance) => {
        const response = await request(app.getHttpServer())
          .post('/accounts')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Conta Zero Ou Negativa', type: 'corrente', balance });

        expect(response.status).toBe(201);
      },
    );

    it('creation is not idempotent — two identical POST /accounts calls create two distinct accounts', async () => {
      const body = { name: 'Duplicada', type: 'corrente', balance: '10.00' };

      const first = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);
      const second = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (first.body as EnvelopeBody<AccountData>).data?.id;
      const secondId = (second.body as EnvelopeBody<AccountData>).data?.id;
      expect(firstId).toBeDefined();
      expect(secondId).toBeDefined();
      expect(firstId).not.toBe(secondId);
    });

    it('two concurrent POST /accounts calls for the same user both succeed with distinct ids (no unique constraint blocks parallel creation)', async () => {
      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/accounts')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Concorrente A', type: 'corrente', balance: '20.00' }),
        request(app.getHttpServer())
          .post('/accounts')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ name: 'Concorrente B', type: 'corrente', balance: '20.00' }),
      ]);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (first.body as EnvelopeBody<AccountData>).data?.id;
      const secondId = (second.body as EnvelopeBody<AccountData>).data?.id;
      expect(firstId).not.toBe(secondId);
    });

    it('rejects an invalid/unrecognized type with 400 — never silently coerced to a default (prohibition P1)', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Tipo Invalido',
          type: 'invalid-type',
          balance: '10.00',
        });

      expect(response.status).toBe(400);
    });

    it('rejects a client-supplied userId field with 400 instead of honoring it (Pitfall 3 / IDOR)', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta IDOR',
          type: 'corrente',
          balance: '10.00',
          userId: '11111111-1111-1111-1111-111111111111',
        });

      expect(response.status).toBe(400);
    });
  });

  describe('list/view/update/delete', () => {
    it('GET /accounts on a freshly-registered user with zero accounts returns 200 with an empty array (edge-probe: empty)', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      const freshToken =
        (loginResponse.body as EnvelopeBody<AuthData>).data?.accessToken ?? '';

      const response = await request(app.getHttpServer())
        .get('/accounts')
        .set('Authorization', `Bearer ${freshToken}`);

      expect(response.status).toBe(200);
      expect((response.body as EnvelopeBody<AccountData[]>).data).toEqual([]);
    });

    it('GET /accounts returns accounts ordered by createdAt ascending, stable across repeated calls with no intervening writes (edge-probe: ordering)', async () => {
      const first = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Ordem 1', type: 'corrente', balance: '1.00' });
      const second = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Ordem 2', type: 'corrente', balance: '1.00' });
      const third = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Ordem 3', type: 'corrente', balance: '1.00' });
      const ids = [first, second, third].map(
        (r) => (r.body as EnvelopeBody<AccountData>).data?.id,
      );

      const call1 = await request(app.getHttpServer())
        .get('/accounts')
        .set('Authorization', `Bearer ${accessToken}`);
      const call2 = await request(app.getHttpServer())
        .get('/accounts')
        .set('Authorization', `Bearer ${accessToken}`);

      const idsFromList = (body: EnvelopeBody<AccountData[]>) =>
        (body.data ?? []).map((a) => a.id).filter((id) => ids.includes(id));

      const listIds1 = idsFromList(call1.body as EnvelopeBody<AccountData[]>);
      const listIds2 = idsFromList(call2.body as EnvelopeBody<AccountData[]>);

      expect(listIds1).toEqual(ids);
      expect(listIds2).toEqual(ids);
    });

    it('two accounts with identical name/type/balance for the same user remain two separate rows (edge-probe: adjacency)', async () => {
      const body = { name: 'Conta Gemea', type: 'corrente', balance: '5.00' };

      const first = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);
      const second = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (first.body as EnvelopeBody<AccountData>).data?.id;
      const secondId = (second.body as EnvelopeBody<AccountData>).data?.id;
      expect(firstId).not.toBe(secondId);

      const list = await request(app.getHttpServer())
        .get('/accounts')
        .set('Authorization', `Bearer ${accessToken}`);
      const ids = ((list.body as EnvelopeBody<AccountData[]>).data ?? []).map(
        (a) => a.id,
      );
      expect(ids).toContain(firstId);
      expect(ids).toContain(secondId);
    });

    it('PATCH /accounts/:id rejects a body containing `balance` with 400, and the balance stays unchanged (D-02)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Balance Lock',
          type: 'corrente',
          balance: '50.00',
        });
      const id = (createResponse.body as EnvelopeBody<AccountData>).data?.id;

      const patchResponse = await request(app.getHttpServer())
        .patch(`/accounts/${id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ balance: '999.00' });
      expect(patchResponse.status).toBe(400);

      const getResponse = await request(app.getHttpServer())
        .get(`/accounts/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(
        (getResponse.body as EnvelopeBody<AccountData>).data?.balance,
      ).toBe('50.00');
    });

    it('PATCH /accounts/:id rejects a body containing `type` with 400 (prohibition P2)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Conta Type Lock', type: 'corrente', balance: '50.00' });
      const id = (createResponse.body as EnvelopeBody<AccountData>).data?.id;

      const patchResponse = await request(app.getHttpServer())
        .patch(`/accounts/${id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ type: 'poupanca' });

      expect(patchResponse.status).toBe(400);
    });

    it('PATCH /accounts/:id with only `{name}` succeeds 200 and leaves `balance` byte-identical (ACCT-04: no drift)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Nome Antigo', type: 'corrente', balance: '77.77' });
      const id = (createResponse.body as EnvelopeBody<AccountData>).data?.id;
      const balanceBefore = (createResponse.body as EnvelopeBody<AccountData>)
        .data?.balance;

      const patchResponse = await request(app.getHttpServer())
        .patch(`/accounts/${id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Novo Nome' });

      expect(patchResponse.status).toBe(200);
      const patched = (patchResponse.body as EnvelopeBody<AccountData>).data;
      expect(patched?.name).toBe('Novo Nome');
      expect(patched?.balance).toBe(balanceBefore);
    });

    it('DELETE /accounts/:id soft-deletes: excludes the account from GET /accounts and GET /accounts/:id (404), never removes the row (D-03)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Para Deletar',
          type: 'corrente',
          balance: '1.00',
        });
      const id = (createResponse.body as EnvelopeBody<AccountData>).data?.id;

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/accounts/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(deleteResponse.status).toBe(200);

      const getResponse = await request(app.getHttpServer())
        .get(`/accounts/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(getResponse.status).toBe(404);

      const listResponse = await request(app.getHttpServer())
        .get('/accounts')
        .set('Authorization', `Bearer ${accessToken}`);
      const ids = (
        (listResponse.body as EnvelopeBody<AccountData[]>).data ?? []
      ).map((a) => a.id);
      expect(ids).not.toContain(id);
    });

    it('three consecutive GET /accounts/:id calls with no intervening writes return the exact same balance string, never a JS number (ACCT-04: no drift)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Sem Drift',
          type: 'corrente',
          balance: '2500.75',
        });
      const id = (createResponse.body as EnvelopeBody<AccountData>).data?.id;

      for (let i = 0; i < 3; i += 1) {
        const getResponse = await request(app.getHttpServer())
          .get(`/accounts/${id}`)
          .set('Authorization', `Bearer ${accessToken}`);

        expect(getResponse.status).toBe(200);
        const body = (getResponse.body as EnvelopeBody<AccountData>).data;
        expect(body?.balance).toBe('2500.75');
        expect(typeof body?.balance).toBe('string');
      }
    });

    it('a malformed :id on GET/PATCH/DELETE returns 400, not a raw 500', async () => {
      const malformedId = 'not-a-uuid';

      const getResponse = await request(app.getHttpServer())
        .get(`/accounts/${malformedId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(getResponse.status).toBe(400);

      const patchResponse = await request(app.getHttpServer())
        .patch(`/accounts/${malformedId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Novo Nome' });
      expect(patchResponse.status).toBe(400);

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/accounts/${malformedId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(deleteResponse.status).toBe(400);
    });

    it('a second DELETE /accounts/:id on an already-deleted account returns 404, not a second 200 (edge-probe: idempotency)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Conta Deletar Duas Vezes',
          type: 'corrente',
          balance: '1.00',
        });
      const id = (createResponse.body as EnvelopeBody<AccountData>).data?.id;

      const firstDelete = await request(app.getHttpServer())
        .delete(`/accounts/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(firstDelete.status).toBe(200);

      const secondDelete = await request(app.getHttpServer())
        .delete(`/accounts/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);
      expect(secondDelete.status).toBe(404);
    });
  });
});
