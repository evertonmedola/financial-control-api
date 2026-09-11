import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/auth/entities/user.entity';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';

// supertest types response.body as `any` — every SUCCESS response this
// project's endpoints return is wrapped in the {data, timestamp} envelope
// (ResponseInterceptor); ERROR responses (thrown exceptions) are NOT wrapped
// — they bypass interceptors and keep Nest's default {message, statusCode}
// shape. Cast explicitly at the read site instead of leaving every
// assertion untyped.
interface AuthUserData {
  id?: string;
  email?: string;
  createdAt?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface EnvelopeBody {
  data?: AuthUserData;
  timestamp?: string;
}

interface ErrorBody {
  message?: string;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let usersRepository: Repository<User>;
  let refreshTokensRepository: Repository<RefreshToken>;

  const uniqueEmail = () =>
    `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'super-secret-password';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    usersRepository = moduleFixture.get<Repository<User>>(
      getRepositoryToken(User),
    );
    refreshTokensRepository = moduleFixture.get<Repository<RefreshToken>>(
      getRepositoryToken(RefreshToken),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('registers a new user and never returns passwordHash', async () => {
      const email = uniqueEmail();

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password });

      const body = response.body as EnvelopeBody;
      expect(response.status).toBe(201);
      expect(body.data).not.toHaveProperty('passwordHash');
      expect(body.data?.email).toBe(email);
    });

    it('rejects a second registration with an already-used email', async () => {
      const email = uniqueEmail();

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const secondResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password });

      expect([400, 409]).toContain(secondResponse.status);

      const count = await usersRepository.count({ where: { email } });
      expect(count).toBe(1);
    });

    it('creates exactly one user row when two concurrent registrations use the identical email', async () => {
      const email = uniqueEmail();

      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post('/auth/register')
          .send({ email, password }),
        request(app.getHttpServer())
          .post('/auth/register')
          .send({ email, password }),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses[0]).toBeLessThan(300);
      expect(statuses[1]).toBeGreaterThanOrEqual(400);

      const count = await usersRepository.count({ where: { email } });
      expect(count).toBe(1);
    });
  });

  describe('POST /auth/login', () => {
    it('returns an accessToken JWT string for correct credentials', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });

      const body = response.body as EnvelopeBody;
      expect(response.status).toBe(200);
      expect(typeof body.data?.accessToken).toBe('string');
      expect((body.data?.accessToken ?? '').split('.')).toHaveLength(3);
    });

    it('login issues refresh token: response has both tokens, and the raw value is never persisted', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });

      const body = response.body as EnvelopeBody;
      expect(response.status).toBe(200);
      expect(typeof body.data?.accessToken).toBe('string');
      expect(typeof body.data?.refreshToken).toBe('string');
      expect((body.data?.refreshToken ?? '').length).toBeGreaterThanOrEqual(64);

      // A direct lookup by the raw refresh token value must return zero rows —
      // only a SHA-256 hash of it is ever persisted (AUTH-03 prohibition P1).
      const rawValueRow = await refreshTokensRepository.findOne({
        where: { tokenHash: body.data?.refreshToken },
      });
      expect(rawValueRow).toBeNull();

      const registeredUser = await usersRepository.findOne({
        where: { email },
      });
      const hashedRow = await refreshTokensRepository.findOne({
        where: { userId: registeredUser?.id },
      });
      expect(hashedRow).not.toBeNull();
      expect(hashedRow?.revokedAt).toBeNull();
      expect(hashedRow?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns a generic 401 for a wrong password', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong-password-123' });

      const body = response.body as ErrorBody;
      expect(response.status).toBe(401);
      expect(body.message).toBe('credenciais inválidas');
    });

    it('returns a byte-identical generic 401 for a non-existent email', async () => {
      const wrongPasswordResponse = await (async () => {
        const email = uniqueEmail();
        await request(app.getHttpServer())
          .post('/auth/register')
          .send({ email, password })
          .expect(201);
        return request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'wrong-password-123' });
      })();

      const nonExistentResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: uniqueEmail(), password });

      const wrongPasswordBody = wrongPasswordResponse.body as ErrorBody;
      const nonExistentBody = nonExistentResponse.body as ErrorBody;

      expect(nonExistentResponse.status).toBe(401);
      expect(nonExistentBody.message).toBe(wrongPasswordBody.message);
      expect(nonExistentBody).toEqual(wrongPasswordBody);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 401 with no Authorization header', async () => {
      const response = await request(app.getHttpServer()).get('/auth/me');
      expect(response.status).toBe(401);
    });

    it('returns the caller own data with a valid access token, excluding passwordHash', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });

      const { accessToken } = (loginResponse.body as EnvelopeBody).data ?? {};

      const meResponse = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      const meBody = meResponse.body as EnvelopeBody;
      expect(meResponse.status).toBe(200);
      expect(meBody.data?.email).toBe(email);
      expect(meBody.data).not.toHaveProperty('passwordHash');
    });

    it('ignores a client-supplied userId in the query string and returns only the caller own data', async () => {
      const emailA = uniqueEmail();
      const emailB = uniqueEmail();

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: emailA, password })
        .expect(201);
      const userBRegisterResponse = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: emailB, password })
        .expect(201);
      const otherUserId = (userBRegisterResponse.body as EnvelopeBody).data?.id;

      const loginA = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: emailA, password });
      const { accessToken } = (loginA.body as EnvelopeBody).data ?? {};

      const meResponse = await request(app.getHttpServer())
        .get(`/auth/me?userId=${otherUserId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      const meBody = meResponse.body as EnvelopeBody;
      expect(meResponse.status).toBe(200);
      expect(meBody.data?.email).toBe(emailA);
      expect(meBody.data?.id).not.toBe(otherUserId);
    });
  });

  describe('response envelope', () => {
    it('wraps every successful response in a {data, timestamp} envelope', async () => {
      const email = uniqueEmail();

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password });

      const body = response.body as EnvelopeBody;
      expect(response.status).toBe(201);
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('timestamp');
      expect(typeof body.timestamp).toBe('string');
      expect(body.data?.email).toBe(email);
      expect(body.data).not.toHaveProperty('passwordHash');
    });

    it('rejects an unexpected extra field on the register payload with 400 instead of silently dropping it', async () => {
      const email = uniqueEmail();

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, isAdmin: true });

      expect(response.status).toBe(400);
    });
  });
});
