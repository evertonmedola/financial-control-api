import { CanActivate, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';
import { User } from '../src/auth/entities/user.entity';

// Dedicated two-user IDOR/cross-tenant regression suite (Phase 1 Plan 5).
// Every endpoint built across Plans 01-04 is exercised together here, from
// the perspective of two independent, concurrently-active users — proving
// the per-plan mitigations (already unit/e2e-tested in isolation in
// auth.e2e-spec.ts) also hold when two real tenants interact with the same
// running app instance. This is the pattern later phases' equivalent suites
// (Phase 2+) will mirror per 01-CONTEXT.md/01-RESEARCH.md.
//
// Same ThrottlerGuard no-op override as auth.e2e-spec.ts — this file alone
// issues 20+ register/login/refresh calls across its cases, far more than
// the 3/5-per-60s limits on /auth/register and /auth/login.
const noopThrottlerGuard: CanActivate = { canActivate: () => true };

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

interface Session {
  email: string;
  id: string;
  accessToken: string;
  refreshToken: string;
}

describe('Cross-tenant isolation (e2e)', () => {
  let app: INestApplication;
  let usersRepository: Repository<User>;
  let refreshTokensRepository: Repository<RefreshToken>;

  const uniqueEmail = (label: string) =>
    `cross-tenant-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

  const registerAndLogin = async (label: string): Promise<Session> => {
    const email = uniqueEmail(label);

    const registerResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const id = (registerResponse.body as EnvelopeBody).data?.id as string;

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const { accessToken, refreshToken } =
      (loginResponse.body as EnvelopeBody).data ?? {};

    return {
      email,
      id,
      accessToken: accessToken as string,
      refreshToken: refreshToken as string,
    };
  };

  describe('GET /auth/me never returns the other user identity', () => {
    it("A's token never returns B's email/id, and vice versa", async () => {
      const userA = await registerAndLogin('me-a');
      const userB = await registerAndLogin('me-b');

      const meA = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${userA.accessToken}`);
      expect(meA.status).toBe(200);
      const bodyA = meA.body as EnvelopeBody;
      expect(bodyA.data?.email).toBe(userA.email);
      expect(bodyA.data?.id).toBe(userA.id);
      expect(bodyA.data?.email).not.toBe(userB.email);
      expect(bodyA.data?.id).not.toBe(userB.id);

      const meB = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${userB.accessToken}`);
      expect(meB.status).toBe(200);
      const bodyB = meB.body as EnvelopeBody;
      expect(bodyB.data?.email).toBe(userB.email);
      expect(bodyB.data?.id).toBe(userB.id);
      expect(bodyB.data?.email).not.toBe(userA.email);
      expect(bodyB.data?.id).not.toBe(userA.id);
    });
  });

  describe('refresh tokens are strictly bound to their issuing user', () => {
    it("presenting A's raw refresh token always resolves to A, never B, and B's independent token is unaffected by A's refresh calls", async () => {
      const userA = await registerAndLogin('refresh-a');
      const userB = await registerAndLogin('refresh-b');

      const refreshA = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userA.refreshToken });
      expect(refreshA.status).toBe(200);
      const newA = (refreshA.body as EnvelopeBody).data ?? {};

      // The freshly-rotated access token must still identify A, never B.
      const meWithNewA = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${newA.accessToken}`);
      expect((meWithNewA.body as EnvelopeBody).data?.email).toBe(userA.email);
      expect((meWithNewA.body as EnvelopeBody).data?.email).not.toBe(
        userB.email,
      );

      // B's independently-issued refresh token is completely unaffected by
      // A's refresh call above — still valid, still resolves to B.
      const refreshB = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userB.refreshToken });
      expect(refreshB.status).toBe(200);
      const newB = (refreshB.body as EnvelopeBody).data ?? {};
      const meWithNewB = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${newB.accessToken}`);
      expect((meWithNewB.body as EnvelopeBody).data?.email).toBe(userB.email);
    });

    it("logging out on A's behalf never revokes B's refresh token", async () => {
      const userA = await registerAndLogin('logout-a');
      const userB = await registerAndLogin('logout-b');

      const logoutA = await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: userA.refreshToken });
      expect([200, 204]).toContain(logoutA.status);

      // A's token is now dead.
      const refreshAAfterLogout = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userA.refreshToken });
      expect(refreshAAfterLogout.status).toBe(401);

      // B's independent, never-touched token remains fully usable.
      const refreshB = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userB.refreshToken });
      expect(refreshB.status).toBe(200);
      expect(typeof (refreshB.body as EnvelopeBody).data?.accessToken).toBe(
        'string',
      );
    });
  });

  describe("reuse-detection revokes only the offending user's token family", () => {
    it("triggering reuse detection on A's token family revokes only A's tokens — B's independently-issued refresh token remains valid and usable afterward", async () => {
      const userA = await registerAndLogin('reuse-a');
      const userB = await registerAndLogin('reuse-b');

      // A rotates once (a normal, legitimate refresh call).
      const rotateA = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userA.refreshToken });
      expect(rotateA.status).toBe(200);
      const rotatedA = (rotateA.body as EnvelopeBody).data ?? {};

      // Replay A's original (now-rotated) token — reuse signal.
      const replayA = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userA.refreshToken });
      expect(replayA.status).toBe(401);

      // Family-scoped revocation must have killed A's brand-new rotated
      // token too (the entire family, not just the replayed row).
      const refreshRotatedA = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: rotatedA.refreshToken });
      expect(refreshRotatedA.status).toBe(401);

      // B's family is completely independent — untouched by A's reuse event.
      const refreshB = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userB.refreshToken });
      expect(refreshB.status).toBe(200);

      // Direct DB check: confirm B still has an unrevoked token row while
      // every one of A's rows is revoked.
      const bTokens = await refreshTokensRepository.find({
        where: { userId: userB.id },
      });
      expect(bTokens.some((t) => t.revokedAt === null)).toBe(true);

      const aTokens = await refreshTokensRepository.find({
        where: { userId: userA.id },
      });
      expect(aTokens.every((t) => t.revokedAt !== null)).toBe(true);
    });
  });

  describe('no endpoint accepts a client-supplied identity override to act as a different user', () => {
    it('GET /auth/me ignores a client-supplied userId/email in the query string', async () => {
      const userA = await registerAndLogin('override-me-query-a');
      const userB = await registerAndLogin('override-me-query-b');

      const response = await request(app.getHttpServer())
        .get(
          `/auth/me?userId=${userB.id}&email=${encodeURIComponent(userB.email)}`,
        )
        .set('Authorization', `Bearer ${userA.accessToken}`);

      expect(response.status).toBe(200);
      const body = response.body as EnvelopeBody;
      expect(body.data?.email).toBe(userA.email);
      expect(body.data?.id).toBe(userA.id);
      expect(body.data?.id).not.toBe(userB.id);
    });

    it("GET /auth/me ignores a client-supplied userId header — the caller's identity always comes from the Bearer token, never a header", async () => {
      const userA = await registerAndLogin('override-me-header-a');
      const userB = await registerAndLogin('override-me-header-b');

      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .set('X-User-Id', userB.id);

      expect(response.status).toBe(200);
      const body = response.body as EnvelopeBody;
      expect(body.data?.email).toBe(userA.email);
      expect(body.data?.id).not.toBe(userB.id);
    });

    it('POST /auth/register rejects a client-supplied id/userId field in the payload instead of honoring it (whitelist + forbidNonWhitelisted)', async () => {
      const email = uniqueEmail('override-register');

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          password,
          id: '11111111-1111-1111-1111-111111111111',
        });

      expect(response.status).toBe(400);

      // No row was created with the attempted override id, and the intended
      // email was never registered as a side effect of the rejected call.
      const byOverrideId = await usersRepository.findOne({
        where: { id: '11111111-1111-1111-1111-111111111111' },
      });
      expect(byOverrideId).toBeNull();
      const byEmail = await usersRepository.findOne({ where: { email } });
      expect(byEmail).toBeNull();
    });

    it('POST /auth/login rejects a client-supplied userId field in the payload instead of honoring it', async () => {
      const userA = await registerAndLogin('override-login-a');
      const userB = await registerAndLogin('override-login-b');

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userA.email, password, userId: userB.id });

      expect(response.status).toBe(400);
    });

    it('POST /auth/refresh rejects a client-supplied userId override alongside a valid token instead of honoring it — the presented token is left untouched', async () => {
      const userA = await registerAndLogin('override-refresh-a');
      const userB = await registerAndLogin('override-refresh-b');

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userA.refreshToken, userId: userB.id });

      expect(response.status).toBe(400);

      // Validation failure happens before the handler runs — A's original
      // token was never consumed and still works normally afterward.
      const refreshAStillValid = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userA.refreshToken });
      expect(refreshAStillValid.status).toBe(200);
    });

    it("POST /auth/logout rejects a client-supplied userId override alongside a valid token instead of honoring it — B's tokens are never touched", async () => {
      const userA = await registerAndLogin('override-logout-a');
      const userB = await registerAndLogin('override-logout-b');

      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: userA.refreshToken, userId: userB.id });

      expect(response.status).toBe(400);

      // Neither A's nor B's token was revoked by the rejected call — both
      // still resolve normally.
      const refreshA = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userA.refreshToken });
      expect(refreshA.status).toBe(200);

      const refreshB = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: userB.refreshToken });
      expect(refreshB.status).toBe(200);
    });
  });
});
