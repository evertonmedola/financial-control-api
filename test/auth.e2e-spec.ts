import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';
import { User } from '../src/auth/entities/user.entity';

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

  describe('POST /auth/refresh', () => {
    const registerAndLogin = async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });

      const data = (loginResponse.body as EnvelopeBody).data ?? {};
      return { email, ...data } as {
        email: string;
        accessToken: string;
        refreshToken: string;
      };
    };

    it('rotation: a valid refresh token returns a brand-new pair and revokes the old row', async () => {
      const { refreshToken } = await registerAndLogin();

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });

      const body = response.body as EnvelopeBody;
      expect(response.status).toBe(200);
      expect(typeof body.data?.accessToken).toBe('string');
      expect(typeof body.data?.refreshToken).toBe('string');
      expect(body.data?.refreshToken).not.toBe(refreshToken);

      const oldTokenHash = crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
      const oldRow = await refreshTokensRepository.findOne({
        where: { tokenHash: oldTokenHash },
      });
      expect(oldRow?.revokedAt).not.toBeNull();
    });

    it('refresh token reuse detection: replaying an already-rotated token is rejected and revokes every sibling token for that user', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      // Two independent logins for the SAME user — two live sessions, two
      // distinct, currently-valid refresh tokens.
      const firstLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });
      const { refreshToken: firstRefreshToken } =
        (firstLogin.body as EnvelopeBody).data ?? {};

      const secondLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });
      const { refreshToken: siblingRefreshToken } =
        (secondLogin.body as EnvelopeBody).data ?? {};

      // Rotate the first session's token — this is a normal, legitimate
      // refresh. The original firstRefreshToken is now revoked (rotated).
      const rotateResponse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstRefreshToken });
      expect(rotateResponse.status).toBe(200);

      // Replay the SAME, now-rotated token — this is the reuse/compromise
      // signal. The replayed request itself must be rejected...
      const replayResponse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: firstRefreshToken });
      expect(replayResponse.status).toBe(401);

      // ...AND every other refresh token belonging to this user — including
      // the still-valid sibling from the second login — must now also be
      // revoked, forcing full re-login everywhere.
      const siblingRefreshAfterReuse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: siblingRefreshToken });
      expect(siblingRefreshAfterReuse.status).toBe(401);
    });

    it('an unknown/garbage refresh token returns 401', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'this-token-was-never-issued' });

      expect(response.status).toBe(401);
    });

    it('an expired (but never-used) refresh token returns 401', async () => {
      const { email } = await registerAndLogin();
      const user = await usersRepository.findOne({ where: { email } });

      const rawExpiredToken = crypto.randomBytes(64).toString('hex');
      const expiredTokenHash = crypto
        .createHash('sha256')
        .update(rawExpiredToken)
        .digest('hex');
      await refreshTokensRepository.save(
        refreshTokensRepository.create({
          userId: user?.id,
          tokenHash: expiredTokenHash,
          expiresAt: new Date(Date.now() - 1000),
          revokedAt: null,
        }),
      );

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: rawExpiredToken });

      expect(response.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the presented refresh token; using it afterward behaves identically to any other revoked token (401)', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });
      const { refreshToken } = (loginResponse.body as EnvelopeBody).data ?? {};

      const logoutResponse = await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken });
      expect([200, 204]).toContain(logoutResponse.status);

      const refreshAfterLogout = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });
      expect(refreshAfterLogout.status).toBe(401);
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

  // A dedicated, separately-compiled app instance — built from the SAME,
  // unmodified AppModule (real ThrottlerGuard active) — so these tests get
  // their own isolated in-memory throttler storage and never share counts
  // with the ~20 register/login calls the rest of this file makes against
  // the shared `app` instance above (which, per Task 2, has its
  // ThrottlerGuard overridden to a no-op specifically to avoid tripping on
  // those unrelated calls).
  describe('rate limiting (throttler)', () => {
    let rateLimitApp: INestApplication;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      rateLimitApp = moduleFixture.createNestApplication();
      await rateLimitApp.init();
    });

    afterAll(async () => {
      await rateLimitApp.close();
    });

    it('returns 429 on the 6th POST /auth/login within the window (limit: 5/60s)', async () => {
      const email = uniqueEmail();
      // Deliberately wrong password — the ThrottlerGuard runs before the
      // route handler, so a failing auth attempt still counts toward the
      // throttle bucket, matching a real credential-stuffing attempt.
      const attempt = () =>
        request(rateLimitApp.getHttpServer())
          .post('/auth/login')
          .send({ email, password: 'wrong-password' });

      const responses = [];
      for (let i = 0; i < 6; i += 1) {
        responses.push(await attempt());
      }

      const statuses = responses.map((r) => r.status);
      expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
      expect(statuses[5]).toBe(429);
    });

    it('returns 429 on the 4th POST /auth/register within the window (limit: 3/60s)', async () => {
      const attempt = () =>
        request(rateLimitApp.getHttpServer())
          .post('/auth/register')
          .send({ email: uniqueEmail(), password });

      const responses = [];
      for (let i = 0; i < 4; i += 1) {
        responses.push(await attempt());
      }

      const statuses = responses.map((r) => r.status);
      expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
      expect(statuses[3]).toBe(429);
    });

    it('an unrelated endpoint (GET /auth/me) is governed by the global default limit, not the tighter login/register limits', async () => {
      // 10 requests comfortably exceeds the 5/3 login/register limits but
      // stays well under the 100/60s global default — proving this route
      // isn't accidentally covered by the tighter per-route overrides.
      const responses = [];
      for (let i = 0; i < 10; i += 1) {
        responses.push(
          await request(rateLimitApp.getHttpServer()).get('/auth/me'),
        );
      }

      expect(responses.every((r) => r.status !== 429)).toBe(true);
      // No Authorization header on any of these — every one is a 401, which
      // itself proves the requests actually reached the guard chain rather
      // than being short-circuited by something unrelated.
      expect(responses.every((r) => r.status === 401)).toBe(true);
    });
  });
});
