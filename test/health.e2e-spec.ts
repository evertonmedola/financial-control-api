import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// /health requires no authentication and this suite issues at most two
// requests, so unlike categories.e2e-spec.ts there is no need for the
// noopThrottlerGuard override or any register/login setup.

interface HealthDetails {
  status?: string;
}

interface HealthData {
  status?: string;
  details?: {
    database?: HealthDetails;
  };
}

interface EnvelopeBody<T> {
  data?: T;
  timestamp?: string;
}

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with app+database status ok/up', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    const body = response.body as EnvelopeBody<HealthData>;
    expect(body.data?.status).toBe('ok');
    expect(body.data?.details?.database?.status).toBe('up');
  });
});
