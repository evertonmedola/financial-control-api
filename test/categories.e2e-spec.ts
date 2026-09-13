import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Same ThrottlerGuard no-op override as accounts.e2e-spec.ts/
// cross-tenant.e2e-spec.ts — this suite issues one register+login call per
// describe block, well within the login/register limits individually, but
// shares a single app instance/throttler bucket across the whole file.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

interface CategoryData {
  id?: string;
  name?: string;
  type?: string;
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

describe('Categories (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  const uniqueEmail = () =>
    `categories-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

  describe('create category', () => {
    it('POST /categories creates a despesa category and returns 201 with the created category', async () => {
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Alimentação', type: 'despesa' });

      expect(response.status).toBe(201);
      const body = (response.body as EnvelopeBody<CategoryData>).data;
      expect(body?.id).toBeDefined();
      expect(body?.name).toBe('Alimentação');
      expect(body?.type).toBe('despesa');
      expect(body?.createdAt).toBeDefined();
    });

    it('POST /categories creates a receita category and returns 201 with the created category', async () => {
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Salário', type: 'receita' });

      expect(response.status).toBe(201);
      const body = (response.body as EnvelopeBody<CategoryData>).data;
      expect(body?.type).toBe('receita');
    });

    it('accepts a name of exactly 100 characters with 201', async () => {
      const name = 'a'.repeat(100);
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name, type: 'despesa' });

      expect(response.status).toBe(201);
    });

    it('rejects a name of 101 characters with 400', async () => {
      const name = 'a'.repeat(101);
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name, type: 'despesa' });

      expect(response.status).toBe(400);
    });

    it('rejects an empty-string name with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: '', type: 'despesa' });

      expect(response.status).toBe(400);
    });

    it('rejects a body missing `type` entirely with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Sem Tipo' });

      expect(response.status).toBe(400);
    });

    it('rejects an invalid/unrecognized type with 400 — never silently coerced to a default (prohibition P1)', async () => {
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Tipo Invalido', type: 'invalid-type' });

      expect(response.status).toBe(400);
    });

    it('duplicate name+type (D-03): second identical POST returns 409, proving the DB-level unique index rejected the second insert (edge-probe: idempotency + adjacency-collide)', async () => {
      // Note: GET /categories (CAT-02) does not exist in this plan's scope
      // (owned by 03-02-PLAN.md) — deviation Rule 3, this plan's Task 2
      // text assumed it existed for a post-hoc list count-check. The 201-
      // then-409 sequence alone is sufficient proof of non-duplication: a
      // Postgres unique-violation aborts the INSERT statement entirely, so
      // no second row is ever created — there is nothing left to count.
      const body = { name: 'Transporte', type: 'despesa' };

      const first = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);
      const second = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
    });

    it('same name, different type is allowed as a distinct category (D-03, edge-probe: adjacency-separate)', async () => {
      const first = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Outros', type: 'receita' });
      const second = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Outros', type: 'despesa' });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const firstId = (first.body as EnvelopeBody<CategoryData>).data?.id;
      const secondId = (second.body as EnvelopeBody<CategoryData>).data?.id;
      expect(firstId).not.toBe(secondId);
    });

    it('two concurrent POST /categories calls with identical body: exactly one 201 and one 409, never both/neither (D-03, edge-probe: concurrency)', async () => {
      // See the duplicate-name test above re: GET /categories not existing
      // in this plan's scope — the exactly-one-201-one-409 status pair,
      // enforced by the DB-level partial unique index (not an app-layer
      // pre-check), is itself the proof that the race resolved to exactly
      // one persisted row, never a 500 and never both succeeding.
      const body = { name: 'Lazer', type: 'despesa' };

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/categories')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(body),
        request(app.getHttpServer())
          .post('/categories')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(body),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
    });

    it('rejects a client-supplied userId field with 400 instead of honoring it (Pitfall 3 / IDOR)', async () => {
      const response = await request(app.getHttpServer())
        .post('/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Categoria IDOR',
          type: 'despesa',
          userId: '11111111-1111-1111-1111-111111111111',
        });

      expect(response.status).toBe(400);
    });
  });
});
