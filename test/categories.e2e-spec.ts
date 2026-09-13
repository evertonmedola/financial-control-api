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
  });
});
